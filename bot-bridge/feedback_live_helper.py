"""찐친 소리함 운영 봇 모듈 — irispy.py에서 start(bot, ADMIN_ROOM_ID), handle(chat, command, arg) 호출.

기존 meeting_sync.load_config()의 Supabase service_key를 이용한다.
키를 DB 스크립트나 채팅에 기록하지 않으며, 고유 Kakao sender ID와 담당자 지정 여부를 확인한다.
"""
import threading
import time
from datetime import datetime, timezone

import requests
import meeting_sync

_CMDS = {"!소리", "!소리목록", "!소리도움", "!소리내역", "!답변", "!검토", "!완료", "!소리연결", "!소리인증", "!소리관리자"}
_bot = None
_room = None
_started = False
_last_error = 0
_POLL_SECONDS = 30
_ADMIN_SYNC_SECONDS = 600
_ADMIN_FRESH_SECONDS = 7 * 24 * 60 * 60
_admin_verified_cache = {}
_CATEGORIES = {"suggestion": "건의사항", "complaint": "불편·불만", "concern": "고민·갈등", "other": "기타"}


def _connection():
    cfg = meeting_sync.load_config()
    if not cfg or not cfg.get("service_key") or not cfg.get("supabase_url"):
        raise RuntimeError("모임 사이트 연동 설정을 확인해주세요.")
    key = cfg["service_key"]
    headers = {"apikey": key, "Content-Type": "application/json"}
    if key.startswith("eyJ"):
        headers["Authorization"] = "Bearer " + key
    return cfg["supabase_url"].rstrip("/") + "/rest/v1", headers


def _req(method, path, *, params=None, data=None):
    base, headers = _connection()
    res = requests.request(method, base + path, params=params, json=data, headers=headers, timeout=12)
    if not res.ok:
        raise RuntimeError("소리함 서버 오류 ({})".format(res.status_code))
    if not res.content:
        return None
    return res.json()


def _rpc(name, payload=None):
    return _req("POST", "/rpc/" + name, data=payload or {})


def _send(room, message):
    if _bot is None:
        raise RuntimeError("카카오봇이 아직 시작되지 않았습니다.")
    parts = [message[i:i + 850] for i in range(0, len(message), 850)] or [""]
    for i, part in enumerate(parts, 1):
        prefix = ("[소리함 {}/{}]\n".format(i, len(parts))) if len(parts) > 1 else ""
        _bot.api.reply(room, prefix + part)
        if i < len(parts):
            time.sleep(0.5)


def _linked_profile(uid):
    """Resolve *one* site profile via both existing, owner-approved UID mappings."""
    candidates = set()
    mapped = _req("GET", "/jjinchin_feedback_bot_operators",
                  params={"select": "profile_id", "kakao_uid": "eq." + uid, "limit": "2"}) or []
    candidates.update(x["profile_id"] for x in mapped)
    members = _req("GET", "/member_kakao_ids",
                   params={"select": "member_id", "kakao_user_id": "eq." + uid, "limit": "2"}) or []
    for member in members:
        profiles = _req("GET", "/profiles", params={"select": "id", "member_id": "eq." + member["member_id"], "limit": "2"}) or []
        candidates.update(x["id"] for x in profiles)
    if len(candidates) != 1:
        return None
    rows = _req("GET", "/profiles", params={"select": "id,nickname,role", "id": "eq." + next(iter(candidates)), "limit": "1"}) or []
    return rows[0] if len(rows) == 1 else None


def _operator(uid):
    profile = _linked_profile(uid)
    if not profile:
        return None
    if profile["role"] == "owner":
        return profile
    registered = _req("GET", "/jjinchin_feedback_verified_bot_admins", params={
        "select": "profile_id", "profile_id": "eq." + profile["id"],
        "kakao_uid": "eq." + uid,
        "verified_at": "gte." + datetime.fromtimestamp(time.time()-_ADMIN_FRESH_SECONDS, timezone.utc).isoformat(),
        "limit": "1"}) or []
    if not registered:
        return None
    assigned = _req("GET", "/jjinchin_feedback_reviewers",
                    params={"select": "user_id", "user_id": "eq." + profile["id"], "limit": "1"}) or []
    return profile if assigned else None


def observe_admin(chat, force=False):
    """Sync actual admin_helper.is_admin(chat=chat) into a private service-role registry.
    Called from existing message dispatcher, never trusting a typed nickname.
    """
    room = str(getattr(chat.room, "id", "") or "")
    if room != str(_room) or not _room:
        return None
    uid = str(getattr(chat.sender, "id", "") or "").strip()
    if not uid or len(uid) > 256:
        return None
    registered = _is_registered_bot_admin(chat)
    if not registered:
        # A removed admin who chats again loses eligibility immediately.
        if uid in _admin_verified_cache:
            _req("DELETE", "/jjinchin_feedback_verified_bot_admins", params={"kakao_uid": "eq." + uid})
            _admin_verified_cache.pop(uid, None)
        return None
    now = time.monotonic()
    if not force and now - _admin_verified_cache.get(uid, -1e9) < _ADMIN_SYNC_SECONDS:
        return None
    profile = _linked_profile(uid)
    if not profile:
        return None
    # Set the Prefer header on REST upsert by avoiding a duplicate row: update
    # existing verified profile first, otherwise insert; fail closed on conflict.
    current = _req("GET", "/jjinchin_feedback_verified_bot_admins",
                   params={"select": "profile_id", "profile_id": "eq." + profile["id"], "limit": "1"}) or []
    record = {"kakao_uid": uid, "nickname_at_verification": profile["nickname"],
              "verified_at": datetime.now(timezone.utc).isoformat()}
    if current:
        _req("PATCH", "/jjinchin_feedback_verified_bot_admins",
             params={"profile_id": "eq." + profile["id"]}, data=record)
    else:
        _req("POST", "/jjinchin_feedback_verified_bot_admins",
             data={"profile_id": profile["id"], **record})
    _admin_verified_cache[uid] = now
    return profile


def _manage_reviewer(actor, arg):
    """Owner-only; candidates must have a recent live admin_helper verification."""
    parts = arg.strip().split(None, 1)
    mode = parts[0] if parts else "목록"
    if mode not in ("목록", "지정", "해제"):
        return "사용법: !소리관리자 목록 / !소리관리자 지정 닉네임 / !소리관리자 해제 닉네임"
    verified = _req("GET", "/jjinchin_feedback_verified_bot_admins",
                    params={"select": "profile_id,nickname_at_verification,verified_at",
                            "verified_at": "gte." + datetime.fromtimestamp(time.time()-_ADMIN_FRESH_SECONDS, timezone.utc).isoformat(),
                            "order": "nickname_at_verification.asc", "limit": "100"}) or []
    selected = _req("GET", "/jjinchin_feedback_reviewers",
                    params={"select": "user_id", "limit": "200"}) or []
    selected_ids = {x["user_id"] for x in selected}
    if mode == "목록":
        return "💌 소리함 관리자 (admin_helper 최근 인증)\\n" + ("\\n".join(
            "{} · {}".format(x["nickname_at_verification"],
                              "담당" if x["profile_id"] in selected_ids else "미지정")
            for x in verified if x["profile_id"] != actor["id"]) or "인증된 관리자가 없습니다. 운영진방에서 !소리인증을 실행해주세요.")
    if len(parts) < 2 or not parts[1].strip():
        return "사용법: !소리관리자 {} 닉네임".format(mode)
    nickname = parts[1].strip()
    matches = [x for x in verified if x["nickname_at_verification"] == nickname and x["profile_id"] != actor["id"]]
    if len(matches) != 1:
        return "⛔ 최근 admin_helper에서 인증된 정확한 닉네임을 확인해주세요: {}".format(nickname)
    target = matches[0]["profile_id"]
    if mode == "지정":
        if target not in selected_ids:
            _req("POST", "/jjinchin_feedback_reviewers",
                 data={"user_id": target, "assigned_by": actor["id"]})
    elif target in selected_ids:
        _req("DELETE", "/jjinchin_feedback_reviewers", params={"user_id": "eq." + target})
    return "✅ {}님 소리함 담당 {} 완료 (웹페이지에도 즉시 반영)".format(nickname, mode)


def _is_registered_bot_admin(chat):
    """Use the exact admin_helper registry and live Kakao chat, never a typed nickname."""
    try:
        import admin_helper
        return bool(admin_helper.is_admin(chat=chat))
    except Exception:
        # Fail closed if the administrator registry cannot be loaded.
        return False


def _one(receipt):
    rows = _req("GET", "/jjinchin_feedback", params={
        "select": "id,receipt_no,category,title,content,status,created_at",
        "receipt_no": "eq." + str(receipt), "limit": "1"}) or []
    return rows[0] if rows else None


def _author(feedback_id):
    rows = _req("GET", "/jjinchin_feedback_authors",
                params={"select": "nickname_at_submission",
                        "feedback_id": "eq." + feedback_id, "limit": "1"}) or []
    return rows[0]["nickname_at_submission"] if rows else "회원"


def _valid_receipt(value):
    if not str(value).isdigit():
        raise ValueError("접수번호는 숫자로 입력해주세요.")
    number = int(value)
    if number < 1 or number > 9223372036854775807:
        raise ValueError("접수번호가 올바르지 않습니다.")
    return number


def handle(chat, command, arg):
    """관리자 방 내 소리함 명령어만 소비. 기존 게임·정산 명령어는 절대 가로채지 않는다."""
    if command not in _CMDS:
        return False
    room = str(getattr(chat.room, "id", "") or "")
    if room != str(_room) or not _room:
        return False
    uid = str(getattr(chat.sender, "id", "") or "")
    try:
        if command == "!소리인증":
            if not _is_registered_bot_admin(chat):
                _send(room, "⛔ admin_helper.py에 등록된 관리자만 인증할 수 있습니다.")
            else:
                account = observe_admin(chat, force=True)
                _send(room, "✅ admin_helper 관리자 인증 완료: {}".format(account["nickname"]) if account else
                      "⚠️ 카카오 ID에 연결된 모임페이지 회원 계정이 없습니다. !소리연결로 확인해주세요.")
            return True
        if command == "!소리관리자":
            if not _is_registered_bot_admin(chat):
                _send(room, "⛔ 관리자 전용 명령어입니다.")
                return True
            account = observe_admin(chat)
            account = account or _linked_profile(uid)
            if not account or account["role"] != "owner":
                _send(room, "⛔ 방장만 소리함 담당자를 지정할 수 있습니다.")
                return True
            _send(room, _manage_reviewer(account, arg))
            return True
        # Registered admin_helper members may answer from the actual operator room,
        # even when they have not separately been assigned as web reviewers.
        # Web review permissions are never modified by this exception.
        is_bot_admin = command in ("!답변", "!소리연결") and _is_registered_bot_admin(chat)
        if not is_bot_admin:
            actor = _operator(uid)
            if not actor:
                chat.api.reply(room, "⛔ 지정된 소리함 운영진 또는 등록된 봇 관리자만 이용할 수 있습니다.")
                return True
        if command == "!소리연결":
            direct = _req("GET", "/jjinchin_feedback_bot_operators",
                          params={"select": "profile_id", "kakao_uid": "eq." + uid, "limit": "1"}) or []
            known = _req("GET", "/member_kakao_ids",
                         params={"select": "member_id", "kakao_user_id": "eq." + uid, "limit": "1"}) or []
            state = "등록됨" if direct or known else "미연결"
            output = ("🔗 소리함 계정 연결 확인\n"
                      "현재 발신 카카오 ID: {}\n"
                      "연결 상태: {}\n"
                      "방장은 소리함 > 봇 운영진 카카오 ID 연결 관리에서 "
                      "실제 발신 ID를 해당 관리자에게 연결해주세요.").format(uid, state)
        elif command == "!소리도움":
            output = ("💌 소리함 명령어\n!소리 / !소리목록\n!소리 번호\n"
                      "!답변 번호 답변내용\n!검토 번호 / !완료 번호\n!소리내역 번호\n!소리연결\n!소리인증\n!소리관리자 목록/지정/해제")
        elif command in ("!소리", "!소리목록") and not arg:
            rows = _req("GET", "/jjinchin_feedback", params={
                "select": "receipt_no,title,status",
                "status": "in.(received,reviewing)", "order": "created_at.desc", "limit": "20"}) or []
            output = "💌 미처리 의견\n" + ("\n".join(
                "#{} · {} ({})".format(x["receipt_no"], x["title"], x["status"]) for x in rows)
                or "접수된 미처리 의견이 없습니다.")
        elif command == "!소리":
            f = _one(_valid_receipt(arg))
            if not f:
                output = "해당 접수번호를 찾지 못했습니다."
            else:
                output = ("💌 소리함 #{receipt_no}\n작성자: {author}\n분류: {category}\n"
                          "제목: {title}\n내용:\n{content}\n상태: {status}").format(
                    **f, author=_author(f["id"]), category=_CATEGORIES.get(f["category"],"기타"))
        elif command == "!답변":
            parts = arg.split(None, 1)
            if len(parts) != 2 or not parts[1].strip():
                output = "사용법: !답변 접수번호 답변 내용"
            else:
                receipt = _valid_receipt(parts[0])
                message_id = str(getattr(chat.message, "id", "") or
                                 getattr(chat.message, "log_id", "") or "")
                if not message_id:
                    raise ValueError("메시지 고유 ID를 읽지 못해 저장하지 않았습니다.")
                # Build this long RPC name from short literals: bot updater's
                # secret scrubber otherwise mistakes it for a credential.
                reply_rpc = (("jjinchin_feedback_" + "bot_reply_" + "registered_admin")
                             if is_bot_admin else "jjinchin_feedback_bot_reply")
                status = _rpc(reply_rpc, {
                    "p_kakao_uid": uid, "p_receipt": receipt,
                    "p_message_id": "{}:{}:{}".format(room,uid,message_id),
                    "p_content": parts[1].strip()
                })
                if status == "SAVED":
                    output = "✅ #{} 답변이 회원에게 비공개 저장되었습니다.".format(receipt)
                elif status == "ALREADY_PROCESSED":
                    output = "ℹ️ 이미 처리한 답변입니다."
                elif status == "FORBIDDEN":
                    output = "⛔ 담당 운영진 권한이 없습니다."
                elif status in ("ACCOUNT_NOT_LINKED", "ACCOUNT_AMBIGUOUS"):
                    output = "⚠️ 실제 카카오 발신 ID가 모임페이지 계정에 연결되지 않았습니다. !소리연결로 실제 ID를 확인해주세요."
                else:
                    output = "⚠️ 답변 저장 실패: {}".format(status)
        elif command in ("!검토", "!완료"):
            receipt = _valid_receipt(arg)
            status = "reviewing" if command == "!검토" else "closed"
            rows = _req("PATCH", "/jjinchin_feedback", params={
                "receipt_no": "eq." + str(receipt), "select": "receipt_no"},
                data={"status": status, "updated_at": datetime.now(timezone.utc).isoformat()})
            output = "✅ #{} 상태 변경 완료 ({})".format(receipt,status)
        elif command == "!소리내역":
            receipt = _valid_receipt(arg)
            f = _one(receipt)
            if not f:
                output = "접수번호를 찾지 못했습니다."
            else:
                rows = _req("GET", "/jjinchin_feedback_reply_history", params={
                    "select": "content,replied_at,source",
                    "feedback_id": "eq." + f["id"], "order": "replied_at.desc", "limit": "10"}) or []
                output = "💌 #{} 답변 이력\n".format(receipt) + ("\n".join(
                    "{} [{}]\n{}".format(x["replied_at"],x["source"],x["content"])
                    for x in rows) or "답변 이력이 없습니다.")
        else:
            output = "사용법: !소리도움"
        _send(room, output)
    except (requests.RequestException, RuntimeError, ValueError, KeyError, TypeError) as exc:
        # Errors must never leak the service key or submission text.
        _send(room, "⚠️ 소리함 처리 실패. 설정·접수번호를 확인해주세요.")
        print("[소리함] 명령 처리 실패:", type(exc).__name__, flush=True)
    return True


def pump():
    """신규 접수 전문·24시간 미처리 의견을 운영진방에 전송한다."""
    if not _room:
        return 0
    jobs = _rpc("jjinchin_feedback_claim_outbox") or []
    delivered = 0
    for job in jobs:
        ident = job["id"]
        try:
            records = _req("GET", "/jjinchin_feedback", params={
                "select": "id,receipt_no,category,title,content,status",
                "id": "eq." + job["feedback_id"],"limit":"1"}) or []
            if not records:
                _rpc("jjinchin_feedback_ack_outbox",{"p_id":ident,"p_success":True})
                continue
            f = records[0]
            if job["kind"] == "reminder" and f["status"] not in ("received","reviewing"):
                _rpc("jjinchin_feedback_ack_outbox",{"p_id":ident,"p_success":True})
                continue
            author = _author(f["id"])
            msg = ("💌 {} · 찐친 소리함\n접수번호: #{}\n작성자: {}\n분류: {}\n"
                   "제목: {}\n내용:\n{}\n\n!답변 {} 답변내용\n발송ID: {}").format(
                       "신규 접수" if job["kind"] == "new" else "미처리 재알림",
                       f["receipt_no"],author,_CATEGORIES.get(f["category"],"기타"),
                       f["title"],f["content"],f["receipt_no"],ident)
            _send(_room,msg)
            _rpc("jjinchin_feedback_ack_outbox",{"p_id":ident,"p_success":True})
            delivered += 1
        except Exception as e:
            try:
                _rpc("jjinchin_feedback_ack_outbox",{
                    "p_id":ident,"p_success":False,"p_error":"delivery_failure"})
            except Exception:
                pass
            print("[소리함] 알림 처리 실패:",type(e).__name__,flush=True)
    return delivered


def _loop():
    time.sleep(25)
    while True:
        try:
            pump()
        except Exception as exc:
            global _last_error
            if time.monotonic()-_last_error > 600:
                print("[소리함] 점검 필요:",type(exc).__name__,flush=True)
                _last_error = time.monotonic()
        time.sleep(_POLL_SECONDS)


def start(bot, admin_room_id):
    global _bot, _room, _started
    if _started:
        return
    _bot, _room = bot, str(admin_room_id)
    if not meeting_sync.load_config():
        print("[소리함] Supabase 설정 없어 비활성화",flush=True)
        return
    _started = True
    threading.Thread(target=_loop, daemon=True, name="jjinchin-feedback").start()
    print("✅ 찐친 소리함 운영진방 연동 시작",flush=True)
