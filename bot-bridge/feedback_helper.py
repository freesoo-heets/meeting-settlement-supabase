"""JJINCHIN private feedback bridge (adapter, requires integration with active irispy.py).

No hardcoded credentials or Kakao room IDs. Environment:
  FEEDBACK_API_ORIGIN  https://<preview-or-production-host>
  FEEDBACK_BOT_SECRET  shared server secret
  FEEDBACK_OPERATOR_ROOM_ID  verified operator room identifier

Integrate handle_message(room_id, sender_uid, message_id, text, send) into the
existing bot dispatcher, ONLY after checking the callback supplies genuine
Kakao sender and room identifiers (never parse those values from chat text).
Call pump(room_id, send) from the existing bot scheduler; do not create another
independent polling loop. Send callback takes (room_id, text).
"""
import json
import os
import urllib.error
import urllib.request

COMMANDS = ("!소리", "!소리목록", "!소리도움", "!답변", "!검토", "!완료", "!소리내역")
MAX_TEXT = 4000


def _api(action, room_id, **kwargs):
    origin = os.getenv("FEEDBACK_API_ORIGIN", "").rstrip("/")
    secret = os.getenv("FEEDBACK_BOT_SECRET", "")
    allowed_room = os.getenv("FEEDBACK_OPERATOR_ROOM_ID", "")
    if not origin.startswith("https://") or not secret or not allowed_room:
        raise RuntimeError("소리함 봇 환경설정이 필요합니다.")
    if str(room_id) != allowed_room:
        raise PermissionError("소리함은 지정된 운영진방 전용입니다.")
    data = json.dumps({"action": action, "roomId": str(room_id), **kwargs}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(origin + "/api/feedback/bot", data=data,
                                 headers={"Content-Type": "application/json",
                                          "Authorization": "Bearer " + secret}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            payload = json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        # Never log or echo sensitive request bodies.
        try:
            error = json.loads(exc.read().decode("utf-8")).get("error", "처리 실패")
        except (ValueError, UnicodeDecodeError):
            error = "처리 실패"
        raise RuntimeError(error) from None
    if not payload.get("ok"):
        raise RuntimeError(payload.get("error", "처리 실패"))
    return payload


def handle_message(room_id, sender_uid, message_id, text, send):
    """Return True if the message was a feedback command. send(room_id, message)."""
    if not isinstance(text, str) or not text.startswith(COMMANDS):
        return False
    if str(room_id) != os.getenv("FEEDBACK_OPERATOR_ROOM_ID", ""):
        return False  # Do not respond in regular member rooms.
    command = text.strip()
    try:
        if command == "!소리도움":
            output = "💌 찐친 소리함\n!소리 / !소리목록\n!소리 번호 (접수 상세)\n!답변 번호 내용 (비공개 즉시 저장)\n!검토 번호 / !완료 번호\n!소리내역 번호"
        elif command == "!소리" or command == "!소리목록":
            result = _api("list", room_id, senderUid=str(sender_uid))
            rows = result.get("rows", [])
            output = "💌 미처리 접수 목록\n" + ("\n".join(
                "#{receipt_no} · {title} ({status})".format(**row) for row in rows) or "미처리 접수가 없습니다.")
            if result.get("limited"):
                output += "\n최근 20건만 표시됩니다."
        elif command.startswith("!소리 "):
            parts = command.split(None, 1)
            receipt = int(parts[1])
            item = _api("detail", room_id, senderUid=str(sender_uid), receipt=receipt)["item"]
            output = ("💌 접수 #{receipt}\n작성자: {nickname}\n분류: {category}\n제목: {title}"
                      "\n내용:\n{content}\n상태: {status}").format(**item)
        elif command.startswith("!소리내역 "):
            receipt = int(command.split(None, 1)[1])
            result = _api("history",room_id,senderUid=str(sender_uid),receipt=receipt)
            history = result.get("history",[])
            output = ("💌 #{0} 답변 이력\n".format(receipt) + ("\n".join(
                "{0} · {1}\n{2}".format(h["replied_at"],h["source"],h["content"]) for h in history
            ) or "아직 답변이 없습니다."))
        elif command.startswith("!검토 ") or command.startswith("!완료 "):
            flag, number = command.split(None,1)
            receipt = int(number)
            status = "reviewing" if flag == "!검토" else "closed"
            _api("status",room_id,senderUid=str(sender_uid),receipt=receipt,status=status)
            output = "✅ #{0} 상태가 {1}(으)로 변경되었습니다.".format(receipt,"검토중" if status=="reviewing" else "종결")
        elif command.startswith("!답변 "):
            parts = command.split(None, 2)
            if len(parts) != 3 or not parts[1].isdigit() or not parts[2].strip():
                output = "사용법: !답변 접수번호 답변내용"
            else:
                result = _api("reply", room_id, senderUid=str(sender_uid),
                              messageId=str(message_id), receipt=int(parts[1]),
                              content=parts[2].strip()[:MAX_TEXT])
                outcome = result.get("outcome")
                output = ("✅ #{0} 답변이 비공개 저장되었습니다.".format(parts[1])
                          if outcome == "SAVED" else "ℹ️ 이미 처리한 답변입니다.")
        else:
            return False
    except (RuntimeError, PermissionError, ValueError, KeyError) as exc:
        output = "⚠️ " + str(exc)
    send(room_id, output)
    return True


def pump(room_id, send):
    """Run from existing scheduler. Retries with stable delivery IDs.

    Kakao send and database ack cannot be atomic; after a network interruption
    a notification may be delivered twice. Stable IDs permit visual dedup.
    """
    if str(room_id) != os.getenv("FEEDBACK_OPERATOR_ROOM_ID", ""):
        return 0
    try:
        jobs = _api("poll", room_id).get("jobs", [])
    except (RuntimeError, PermissionError):
        return 0
    sent = 0
    for job in jobs:
        marker = job["id"]
        text = ("💌 {kind} · 찐친 소리함\n접수번호: #{receipt}\n작성자: {nickname}"
                "\n분류: {category}\n제목: {title}\n내용:\n{content}"
                "\n\n!답변 {receipt} 답변내용\n발송ID: {id}").format(
            kind="신규 접수" if job["kind"] == "new" else "미처리 24시간 재알림",
            receipt=job["receipt"], nickname=job["nickname"], category=job["category"],
            title=job["title"], content=job["content"], id=marker)
        try:
            send(room_id, text)
            _api("ack", room_id, id=marker, success=True)
            sent += 1
        except Exception:
            # Do not store/send user text in errors. Server handles bounded retries.
            try:
                _api("ack", room_id, id=marker, success=False, error="transport_failure")
            except Exception:
                pass
    return sent
