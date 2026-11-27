"""카카오톡 !ㅊㅊ 출석순위 보상 규칙 (2026-11-27 확정안).

기존 출석 처리부에서 '새로 출석이 확정된 사용자'의 1-based 순위를 계산한
후 reward_for_rank(rank)를 호출하세요. 출석 중복검사, 카카오 UID 식별,
날짜 경계, 지급 장부 기록과 point_helper.add_experience 호출은
기존 attendance_helper.py 그대로 유지해야 합니다.

주의: 이 파일만 추가해도 운영 중인 !ㅊㅊ의 지급액은 변경되지 않습니다.
실제 bot에 있는 출석 점수 결정 코드를 연결한 뒤 별도 검증/배포해야 합니다.
"""

from typing import Final

TOP_10_POINTS: Final[tuple[int, ...]] = (
    250, 200, 150, 140, 130, 120, 115, 110, 105, 100
)
OTHER_POINTS: Final[int] = 90


def reward_for_rank(rank: int) -> int:
    """1부터 시작하는 출석 순위에 대한 지급 점수. 잘못된 순위는 거부한다."""
    if isinstance(rank, bool) or not isinstance(rank, int) or rank < 1:
        raise ValueError('출석 순위는 1 이상의 정수여야 합니다.')
    if rank <= len(TOP_10_POINTS):
        return TOP_10_POINTS[rank - 1]
    return OTHER_POINTS
