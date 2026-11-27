import importlib.util
from pathlib import Path
import unittest

module_path = Path(__file__).resolve().parents[1] / 'attendance_rank_rewards.py'
spec = importlib.util.spec_from_file_location('attendance_rank_rewards_test', module_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
OTHER_POINTS = module.OTHER_POINTS
TOP_10_POINTS = module.TOP_10_POINTS
reward_for_rank = module.reward_for_rank


class TestAttendanceRankRewards(unittest.TestCase):
    def test_top_ten(self):
        self.assertEqual(tuple(reward_for_rank(i) for i in range(1, 11)),
                         (250, 200, 150, 140, 130, 120, 115, 110, 105, 100))

    def test_eleventh_and_later(self):
        for rank in (11, 12, 31, 100, 10000):
            with self.subTest(rank=rank):
                self.assertEqual(reward_for_rank(rank), 90)

    def test_top_three_unchanged(self):
        self.assertEqual([reward_for_rank(i) for i in (1, 2, 3)], [250, 200, 150])

    def test_strictly_decreasing_top_ten(self):
        self.assertTrue(all(a > b for a, b in zip(TOP_10_POINTS, TOP_10_POINTS[1:])))
        self.assertGreater(TOP_10_POINTS[-1], OTHER_POINTS)

    def test_previous_31_attendee_example(self):
        self.assertEqual(sum(reward_for_rank(i) for i in range(1, 32)), 3310)
        self.assertEqual(250 + 200 + 150 + 28 * 90, 3120)

    def test_invalid_rank(self):
        for rank in (0, -1, True, 1.0, '1', None):
            with self.subTest(rank=rank):
                with self.assertRaises(ValueError):
                    reward_for_rank(rank)


if __name__ == '__main__':
    unittest.main()
