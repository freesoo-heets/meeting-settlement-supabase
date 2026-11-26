"""찐친 소리함 운영 봇 모듈 — irispy.py에서 start(bot, ADMIN_ROOM_ID), handle(chat, command, arg) 호출.

기존 meeting_sync.load_config()의 Supabase service_key를 이용한다.
키를 DB 스크립트나 채팅에 기록하지 않으며, 고유 Kakao sender ID와 담당자 지정 여부를 확인한다.
"""
import threading
import time
from datetime import datetime, timezone

import requests
import meeting_sync

_CMDS = {"!소리", "!소리목록", "!소리도움", "!소리내역", "!답변", "!검토", "!완료"}
_bot = None
_room = None
_started = False
_last_error = 0
_POLL_SECONDS = 30
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


def _operator(uid):
    rows = _req("GET", "/jjinchin_feedback_bot_operators",
                params={"select": "profile_id", "kakao_uid": "eq." + uid, "limit": "1"}) or []
    if not rows:
        return None
    profile_id = rows[0]["profile_id"]
    profiles = _req("GET", "/profiles", params={"select": "id,nickname,role",
                  "id": "eq." + profile_id, "limit": "1"}) or []
    if not profiles:
        return None
    profile = profiles[0]
    if profile["role"] == "owner":
        return profile
    if profile["role"] != "admin":
        return None
    assigned = _req("GET", "/jjinchin_feedback_reviewers",
                    params={"select": "user_id", "user_id": "eq." + profile_id,
                            "limit": "1"}) or []
    return profile if assigned else None


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
        actor = _operator(uid)
        if not actor:
            chat.api.reply(room, "⛔ 지정된 소리함 운영진만 이용할 수 있습니다.")
            return True
        if command == "!소리도움":
            output = ("💌 소리함 명령어\n!소리 / !소리목록\n!소리 번호\n"
                      "!답변 번호 답변내용\n!검토 번호 / !완료 번호\n!소리내역 번호")
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
                status = _rpc("jjinchin_feedback_bot_reply", {
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
