"""Tests for admin_helper-based Kakao reply authorization.

Run: python -m unittest discover -s bot-bridge/tests -v
No production Supabase requests and no Kakao sends.
"""
import importlib.util
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch

module_path = Path(__file__).resolve().parents[1] / "feedback_live_helper.py"
request_stub = ModuleType("requests")
request_stub.RequestException = Exception
meeting_stub = ModuleType("meeting_sync")
meeting_stub.load_config = lambda: {}
admin_stub = ModuleType("admin_helper")
admin_stub.is_admin = lambda chat=None: False

with patch.dict(sys.modules, {
    "requests": request_stub,
    "meeting_sync": meeting_stub,
    "admin_helper": admin_stub
}):
    spec = importlib.util.spec_from_file_location("feedback_live_helper_test", module_path)
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)


class FeedbackAdminHelperTests(TestCase):
    def setUp(self):
        # Import is intentionally lazy in the production helper.
        # Preserve the test admin_helper stub for the entire handler call.
        self.admin_modules = patch.dict(sys.modules, {"admin_helper": admin_stub})
        self.admin_modules.start()
        self.sent = []
        helper._admin_verified_cache.clear()
        self.chat = SimpleNamespace(
            room=SimpleNamespace(id="real-operator-room"),
            sender=SimpleNamespace(id="stable-kakao-uid",name="admin display name"),
            message=SimpleNamespace(id="msg-123"),
            api=SimpleNamespace(reply=lambda room, content: self.sent.append((room, content)))
        )
        helper._room="real-operator-room"
        helper._bot=SimpleNamespace(api=self.chat.api)

    def tearDown(self):
        self.admin_modules.stop()

    def test_admin_helper_registered_can_reply_without_web_reviewer(self):
        admin_stub.is_admin=lambda chat=None: chat is self.chat
        with patch.object(helper,"_rpc",return_value="SAVED") as rpc,patch.object(helper,"_operator") as operator:
            self.assertTrue(helper.handle(self.chat,"!답변","42 답변 내용을 저장합니다"))
            operator.assert_not_called()
            self.assertEqual(rpc.call_args.args[0], "jjinchin_feedback_bot_reply_registered_admin")
            self.assertEqual(rpc.call_args.args[1]["p_kakao_uid"], "stable-kakao-uid")
            self.assertEqual(rpc.call_args.args[1]["p_message_id"],"real-operator-room:stable-kakao-uid:msg-123")
        self.assertIn("비공개 저장", self.sent[0][1])

    def test_verified_admin_can_inspect_real_sender_uid(self):
        admin_stub.is_admin=lambda chat=None: chat is self.chat
        with patch.object(helper,"_req",return_value=[]) as req,patch.object(helper,"_operator") as operator:
            self.assertTrue(helper.handle(self.chat,"!소리연결",""))
            operator.assert_not_called()
            self.assertEqual(req.call_count,2)
        self.assertIn("stable-kakao-uid",self.sent[0][1])
        self.assertIn("미연결",self.sent[0][1])

    def test_unverified_sender_cannot_inspect_uid(self):
        admin_stub.is_admin=lambda chat=None: False
        with patch.object(helper,"_operator",return_value=None),patch.object(helper,"_req") as req:
            self.assertTrue(helper.handle(self.chat,"!소리연결",""))
            req.assert_not_called()
        self.assertNotIn("stable-kakao-uid",self.sent[0][1])

    def test_not_linked_reply_suggests_sender_check(self):
        admin_stub.is_admin=lambda chat=None: True
        with patch.object(helper,"_rpc",return_value="ACCOUNT_NOT_LINKED"):
            self.assertTrue(helper.handle(self.chat,"!답변","4 답변"))
        self.assertIn("!소리연결",self.sent[0][1])

    def test_admin_helper_verified_identity_synced_from_real_chat(self):
        admin_stub.is_admin=lambda chat=None: chat is self.chat
        account={"id":"profile-123","nickname":"숨차","role":"admin"}
        with patch.object(helper,"_linked_profile",return_value=account),patch.object(helper,"_req",side_effect=[
            [],None
        ]) as req:
            result=helper.observe_admin(self.chat,force=True)
            self.assertEqual(result["id"],"profile-123")
            self.assertEqual(req.call_args.args[:2],("POST","/jjinchin_feedback_verified_bot_admins"))
            self.assertEqual(req.call_args.kwargs["data"]["kakao_uid"],"stable-kakao-uid")

    def test_nonadmin_chat_never_attests_admin_status(self):
        admin_stub.is_admin=lambda chat=None: False
        with patch.object(helper,"_linked_profile") as identity,patch.object(helper,"_req") as requests:
            self.assertIsNone(helper.observe_admin(self.chat,force=True))
            identity.assert_not_called()
            requests.assert_not_called()

    def test_owner_bot_command_assigns_existing_verified_admin(self):
        admin_stub.is_admin=lambda chat=None: True
        owner={"id":"owner-1","nickname":"방장","role":"owner"}
        recent="2099-01-01T00:00:00+00:00"
        with patch.object(helper,"observe_admin",return_value=owner),patch.object(helper,"_req",side_effect=[
            [{"profile_id":"target-2","nickname_at_verification":"카티","verified_at":recent}],
            [],
            None,
        ]) as request:
            self.assertTrue(helper.handle(self.chat,"!소리관리자","지정 카티"))
            self.assertEqual(request.call_args.args[:2],("POST","/jjinchin_feedback_reviewers"))
            self.assertEqual(request.call_args.kwargs["data"]["user_id"],"target-2")
        self.assertIn("지정 완료",self.sent[0][1])

    def test_nonowner_cannot_assign_bot_admins(self):
        admin_stub.is_admin=lambda chat=None: True
        admin={"id":"admin-3","nickname":"카티","role":"admin"}
        with patch.object(helper,"observe_admin",return_value=admin),patch.object(helper,"_req") as requests:
            self.assertTrue(helper.handle(self.chat,"!소리관리자","지정 누룽"))
            requests.assert_not_called()
        self.assertIn("방장만",self.sent[0][1])

    def test_not_registered_and_not_web_reviewer_is_denied(self):
        admin_stub.is_admin=lambda chat=None: False
        with patch.object(helper,"_operator",return_value=None),patch.object(helper,"_rpc") as rpc:
            self.assertTrue(helper.handle(self.chat,"!답변","42 blocked"))
            rpc.assert_not_called()
        self.assertIn("⛔",self.sent[0][1])

    def test_existing_designated_web_reviewer_still_works(self):
        admin_stub.is_admin=lambda chat=None: False
        with patch.object(helper,"_operator",return_value={"id":"profile-id"}),patch.object(helper,"_rpc",return_value="SAVED") as rpc:
            self.assertTrue(helper.handle(self.chat,"!답변","42 existing reviewer"))
            self.assertEqual(rpc.call_args.args[0],"jjinchin_feedback_bot_reply")

    def test_registered_admin_does_not_gain_web_inbox_permissions(self):
        admin_stub.is_admin=lambda chat=None: True
        with patch.object(helper,"_operator",return_value=None),patch.object(helper,"_one") as detail:
            self.assertTrue(helper.handle(self.chat,"!소리","42"))
            detail.assert_not_called()
        self.assertIn("⛔",self.sent[0][1])

    def test_wrong_room_is_ignored(self):
        admin_stub.is_admin=lambda chat=None: True
        self.chat.room.id="not-operators"
        with patch.object(helper,"_rpc") as rpc:
            self.assertFalse(helper.handle(self.chat,"!답변","42 blocked"))
            rpc.assert_not_called()

    def test_admin_helper_error_fails_closed(self):
        admin_stub.is_admin=lambda chat=None: (_ for _ in ()).throw(RuntimeError("test"))
        with patch.object(helper,"_operator",return_value=None),patch.object(helper,"_rpc") as rpc:
            self.assertTrue(helper.handle(self.chat,"!답변","42 blocked"))
            rpc.assert_not_called()
        self.assertIn("⛔",self.sent[0][1])


if __name__=="__main__":
    import unittest
    unittest.main()
