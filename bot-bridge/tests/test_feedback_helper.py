"""Unit tests for the framework-agnostic feedback adapter.

Run: python -m unittest discover -s bot-bridge/tests -v
No external network, real Kakao room, or Supabase credentials needed.
"""
import importlib.util
import os
from pathlib import Path
import unittest
from unittest.mock import patch

MODULE = Path(__file__).resolve().parents[1] / "feedback_helper.py"
spec = importlib.util.spec_from_file_location("feedback_helper", MODULE)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class FeedbackBotTests(unittest.TestCase):
    def setUp(self):
        self.sent = []
        self.send = lambda room, text: self.sent.append((room, text))
        self.env = patch.dict(os.environ, {"FEEDBACK_OPERATOR_ROOM_ID": "room-operators"})
        self.env.start()

    def tearDown(self):
        self.env.stop()

    def test_ignore_regular_room(self):
        with patch.object(bridge, "_api") as call:
            self.assertFalse(bridge.handle_message("members","u1","m1","!답변 42 비공개",self.send))
            call.assert_not_called()
        self.assertFalse(self.sent)

    def test_non_feedback_commands_are_unaffected(self):
        self.assertFalse(bridge.handle_message("room-operators","u1","m1","!정산",self.send))
        self.assertFalse(self.sent)

    def test_reply_keeps_real_sender_and_message_id(self):
        with patch.object(bridge, "_api", return_value={"ok":True,"outcome":"SAVED"}) as call:
            self.assertTrue(bridge.handle_message("room-operators","kakao-123","msg-9","!답변 1024 답변 내용",self.send))
            self.assertEqual(call.call_args.args,("reply","room-operators"))
            self.assertEqual(call.call_args.kwargs["senderUid"],"kakao-123")
            self.assertEqual(call.call_args.kwargs["messageId"],"msg-9")
            self.assertEqual(call.call_args.kwargs["receipt"],1024)
            self.assertEqual(call.call_args.kwargs["content"],"답변 내용")
        self.assertIn("저장",self.sent[0][1])

    def test_duplicate_reply_is_not_reported_as_new(self):
        with patch.object(bridge, "_api", return_value={"ok":True,"outcome":"ALREADY_PROCESSED"}):
            self.assertTrue(bridge.handle_message("room-operators","u1","m1","!답변 1024 중복",self.send))
        self.assertIn("이미 처리",self.sent[0][1])

    def test_claim_ack_success(self):
        jobs=[{"id":"delivery-1","kind":"new","receipt":42,"nickname":"차차",
               "category":"건의사항","title":"의견","content":"전문","createdAt":"now"}]
        def fake(action, room, **kwargs):
            return {"jobs":jobs} if action=="poll" else {"ok":True}
        with patch.object(bridge,"_api",side_effect=fake) as call:
            self.assertEqual(bridge.pump("room-operators",self.send),1)
            self.assertEqual(call.call_args.kwargs["success"],True)
        self.assertIn("전문",self.sent[0][1])

    def test_failed_delivery_is_acknowledged_for_retry(self):
        def fake(action, room, **kwargs):
            if action=="poll":
                return {"jobs":[{"id":"delivery-2","kind":"new","receipt":2,
                  "nickname":"차차","category":"건의사항","title":"제목","content":"내용"}]}
            return {"ok":True}
        def broken(room,text):
            raise RuntimeError("transport error")
        with patch.object(bridge,"_api",side_effect=fake) as call:
            self.assertEqual(bridge.pump("room-operators",broken),0)
            self.assertEqual(call.call_args.kwargs["success"],False)

if __name__=="__main__":
    unittest.main()
