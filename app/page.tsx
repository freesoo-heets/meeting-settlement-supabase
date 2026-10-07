"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { matchesHangul } from "../lib/hangulSearch";
import GameHub, { type GameKind } from "./GameHub";
import { ChatLogModal, chatAgo, useLastChats } from "./ChatLog";

type Member = {
  id: string;
  name: string;
  active: boolean;
  join_date: string;
  birthday: string | null;
  withdrawn_at: string | null;
  created_at: string;
  is_guest?: boolean; // 카톡방 명단에 없이 가입한 사람 (회원현황에서 따로 보여준다)
};

// 카톡 봇 점수판 스냅샷 (봇이 1분마다 bot_points 에 올린다)
type BotPoint = {
  kakao_uid: string;
  name: string;
  exp: number;
  rank: number | null;
  trophies: string | null;
  tickets: number;
  season: number | null;
  last_active: string | null;
  synced_at: string;
};

type MeetingRow = {
  id: string;
  date: string;
  title: string;
  cost: number | string | null;
  created_at: string;
  host_member?: string | null; // 벙주 (벙포 지급 대상)
};

type AttendanceRow = {
  meeting_id: string;
  member_id: string;
  online?: boolean; // 온라인 참석 (벙포 50%)
};

type SettlementAdjustment = {
  id: string;
  meeting_id: string;
  member_id: string;
  amount: number | string;
};

type MeetingGuest = {
  id: string;
  meeting_id: string;
  name: string;
  fixed_amount: number | string | null;
  created_at: string;
};

type MeetingPrepayment = {
  id: string;
  meeting_id: string;
  member_id: string;
  amount: number | string;
};

type Meeting = MeetingRow & {
  attendeeIds: string[];
  onlineIds: string[];
  guests: MeetingGuest[];
};

type MainTab = "dashboard" | "meetings" | "members" | "monthly" | "history" | "help";
type MemberFilter = "all" | "active" | "warning" | "withdrawn";
type MemberSort = "nickname_asc" | "nickname_desc" | "join_desc" | "join_asc" | "last_desc" | "last_asc" | "points_desc" | "chat_desc" | "chat_asc";
type MonthlySortKey = "member" | "status" | "join" | "attendance" | "last" | "burden" | "warning";
type SortDirection = "asc" | "desc";
type AttendeeSort = "selected_first" | "nickname_asc" | "nickname_desc" | "join_desc" | "join_asc" | "last_desc" | "last_asc" | "count_desc";
type GuestSort = "nickname_asc" | "nickname_desc" | "added_desc" | "added_asc";
type AppRole = "owner" | "admin" | "user";

type Profile = {
  id: string;
  member_id: string;
  nickname: string;
  role: AppRole;
};

type ActivityLog = {
  id: string;
  actor_id: string;
  actor_nickname: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  description: string;
  created_at: string;
};

function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function daysBetween(from: string, to: string) {
  const a = new Date(`${from}T00:00:00`).getTime();
  const b = new Date(`${to}T00:00:00`).getTime();
  return Math.max(0, Math.floor((b - a) / 86400000));
}

function won(value: number) {
  return `${new Intl.NumberFormat("ko-KR").format(Math.round(value))}원`;
}

function shiftMonth(month: string, offset: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(year, monthNumber - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function calendarDates(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const firstDay = new Date(year, monthNumber - 1, 1).getDay();
  const lastDate = new Date(year, monthNumber, 0).getDate();
  const previousLastDate = new Date(year, monthNumber - 1, 0).getDate();
  const cells: { date: string; day: number; inMonth: boolean }[] = [];

  for (let index = firstDay - 1; index >= 0; index -= 1) {
    const date = new Date(year, monthNumber - 2, previousLastDate - index);
    cells.push({
      date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
      day: date.getDate(),
      inMonth: false,
    });
  }

  for (let day = 1; day <= lastDate; day += 1) {
    cells.push({
      date: `${month}-${String(day).padStart(2, "0")}`,
      day,
      inMonth: true,
    });
  }

  let nextDay = 1;
  while (cells.length % 7 !== 0 || cells.length < 42) {
    const date = new Date(year, monthNumber, nextDay);
    cells.push({
      date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
      day: date.getDate(),
      inMonth: false,
    });
    nextDay += 1;
  }

  return cells;
}

export default function Home() {
  useEffect(() => {
    document.title = "[86~02] 강서구 찐친만들기❤️";
  }, []);

  const today = todayString();
  const currentMonth = today.slice(0, 7);

  const [mainTab, setMainTab] = useState<MainTab>("dashboard");
  const [showDashboardCosts, setShowDashboardCosts] = useState(false);
  const [meetingCalendarMonth, setMeetingCalendarMonth] = useState(currentMonth);
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(today);
  const backupRestoreInputRef = useRef<HTMLInputElement | null>(null);
  const [memberCalendarMonth, setMemberCalendarMonth] = useState(currentMonth);
  const [members, setMembers] = useState<Member[]>([]);
  const [botPoints, setBotPoints] = useState<BotPoint[]>([]);
  const [showPointRanking, setShowPointRanking] = useState(false);
  const [showGames, setShowGames] = useState(false);
  // 카톡 대국신청 링크(?omok= / ?alkkagi= / ?catch=)로 들어온 경우
  const [gameInvite, setGameInvite] = useState<{ kind: GameKind; id: string } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let invite: { kind: GameKind; id: string } | null = null;
    for (const kind of ["omok", "alkkagi", "catch"] as GameKind[]) {
      const id = params.get(kind);
      if (id) invite = { kind, id };
    }
    try {
      if (invite) window.sessionStorage.setItem("gameInvite", JSON.stringify(invite));
      else {
        const saved = window.sessionStorage.getItem("gameInvite");
        if (saved) invite = JSON.parse(saved) as { kind: GameKind; id: string };
      }
    } catch {
      // 저장소를 못 써도 주소의 값으로 진행한다
    }
    if (invite) setGameInvite(invite);
  }, []);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [adjustments, setAdjustments] = useState<SettlementAdjustment[]>([]);
  const [prepayments, setPrepayments] = useState<MeetingPrepayment[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);

  const [authLoading, setAuthLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState("");
  const [currentRole, setCurrentRole] = useState<AppRole | null>(null);
  const [currentNickname, setCurrentNickname] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [loginNickname, setLoginNickname] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [signupNickname, setSignupNickname] = useState("");
  const [signupBirthday, setSignupBirthday] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupPasswordConfirm, setSignupPasswordConfirm] = useState("");
  const [loginNotice, setLoginNotice] = useState("");
  const [showCreatorSetup, setShowCreatorSetup] = useState(false);
  const [creatorSetupKey, setCreatorSetupKey] = useState("");
  const [creatorNickname, setCreatorNickname] = useState("");
  const [ownerExists, setOwnerExists] = useState<boolean | null>(null);

  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [selectedMeetingId, setSelectedMeetingId] = useState("");

  const [memberSearch, setMemberSearch] = useState("");
  const [memberFilter, setMemberFilter] = useState<MemberFilter>("all");
  const [memberSort, setMemberSort] = useState<MemberSort>("nickname_asc");
  const [monthlySortKey, setMonthlySortKey] = useState<MonthlySortKey>("member");
  const [monthlySortDirection, setMonthlySortDirection] = useState<SortDirection>("asc");

  const [newMeetingDate, setNewMeetingDate] = useState(today);
  const [newMeetingTitle, setNewMeetingTitle] = useState("");
  const [newGuestName, setNewGuestName] = useState("");
  const [attendeeSearch, setAttendeeSearch] = useState("");
  const [attendeeSort, setAttendeeSort] = useState<AttendeeSort>("selected_first");
  const [guestSort, setGuestSort] = useState<GuestSort>("nickname_asc");
  const [detailMeetingId, setDetailMeetingId] = useState("");
  const [editingMeetingId, setEditingMeetingId] = useState("");
  const [editingMeetingTitle, setEditingMeetingTitle] = useState("");
  const [editingMeetingDate, setEditingMeetingDate] = useState("");
  const [memberDetailId, setMemberDetailId] = useState("");
  const [chatLogName, setChatLogName] = useState(""); // 📜 채팅 내역 창
  const [noticePick, setNoticePick] = useState<string[]>([]); // 월별 참석 현황: 알림 보낼 회원 선택
  const [noticeBusy, setNoticeBusy] = useState(false);
  const [showMyActivity, setShowMyActivity] = useState(false);
  const [showAccountPanel, setShowAccountPanel] = useState(false);

  type PetLinkStatus = {
    linked: boolean;
    externalMemberId?: string;
    externalNickname?: string;
    profileId?: string;
    petNickname?: string;
    linkedAt?: string;
    meetingNickname?: string;
  };

  const [petLinkStatus, setPetLinkStatus] =
    useState<PetLinkStatus | null>(null);
  const [petLinkLoading, setPetLinkLoading] = useState(false);
  const [petLinkSubmitting, setPetLinkSubmitting] = useState(false);
  const [petLinkError, setPetLinkError] = useState("");

  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [adminResetPassword, setAdminResetPassword] = useState("");
  const [adminResetPasswordConfirm, setAdminResetPasswordConfirm] = useState("");
  const [showAdminPasswordReset, setShowAdminPasswordReset] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [showMobileMore, setShowMobileMore] = useState(false);
  const [openMemberMenuId, setOpenMemberMenuId] = useState("");

  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberJoinDate, setNewMemberJoinDate] = useState(today);
  const [newMemberBirthday, setNewMemberBirthday] = useState("");
  const [showAdminMemberAdd, setShowAdminMemberAdd] = useState(false);
  const [editingNicknameId, setEditingNicknameId] = useState("");
  const [editingNickname, setEditingNickname] = useState("");
  const [editingJoinId, setEditingJoinId] = useState("");
  const [editingJoinDate, setEditingJoinDate] = useState("");
  const [editingBirthdayId, setEditingBirthdayId] = useState("");
  const [editingBirthday, setEditingBirthday] = useState("");
  const [editingCostId, setEditingCostId] = useState("");
  const [editingCost, setEditingCost] = useState("");

  const [memberFixedDrafts, setMemberFixedDrafts] = useState<Record<string, string>>({});
  const [guestFixedDrafts, setGuestFixedDrafts] = useState<Record<string, string>>({});
  const [prepaymentDrafts, setPrepaymentDrafts] = useState<Record<string, string>>({});

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const loadAll = useCallback(async () => {
    setLoading(true);

    const [
      memberResult,
      meetingResult,
      attendanceResult,
      adjustmentResult,
      guestResult,
      prepaymentResult,
      profileResult,
      activityLogResult,
    ] = await Promise.all([
      (async () => {
        const query = (columns: string) =>
          supabase
            .from("members")
            .select(columns)
            .order("active", { ascending: false })
            .order("join_date", { ascending: true });
        const withGuest = await query("id,name,active,join_date,birthday,withdrawn_at,created_at,is_guest");
        // 게스트 칸(is_guest)이 DB 에 아직 없으면 빼고 다시 불러온다
        return withGuest.error?.code === "42703"
          ? await query("id,name,active,join_date,birthday,withdrawn_at,created_at")
          : withGuest;
      })(),
      (async () => {
        // 벙주 칸(host_member)이 DB 에 아직 없으면 빼고 다시 불러온다
        const query = (columns: string) => supabase.from("meetings").select(columns).order("date", { ascending: false });
        const withHost = await query("id,date,title,cost,created_at,host_member");
        return withHost.error?.code === "42703" ? await query("id,date,title,cost,created_at") : withHost;
      })(),
      (async () => {
        const withOnline = await supabase.from("attendance").select("meeting_id,member_id,online");
        return withOnline.error?.code === "42703"
          ? await supabase.from("attendance").select("meeting_id,member_id")
          : withOnline;
      })(),
      supabase
        .from("settlement_adjustments")
        .select("id,meeting_id,member_id,amount"),
      supabase
        .from("meeting_guests")
        .select("id,meeting_id,name,fixed_amount,created_at")
        .order("created_at", { ascending: true }),
      supabase
        .from("meeting_prepayments")
        .select("id,meeting_id,member_id,amount"),
      supabase
        .from("profiles")
        .select("id,member_id,nickname,role"),
      supabase
        .from("activity_logs")
        .select("id,actor_id,actor_nickname,action,entity_type,entity_id,description,created_at")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    const error =
      memberResult.error ||
      meetingResult.error ||
      attendanceResult.error ||
      adjustmentResult.error ||
      guestResult.error ||
      prepaymentResult.error ||
      profileResult.error ||
      activityLogResult.error;

    if (error) {
      setNotice(`데이터 불러오기 실패: ${error.message}`);
      setLoading(false);
      return;
    }

    const memberRows = (memberResult.data ?? []) as unknown as Member[];
    const meetingRows = (meetingResult.data ?? []) as unknown as MeetingRow[];
    const attendanceRows = (attendanceResult.data ?? []) as unknown as AttendanceRow[];
    const onlineByMeeting = new Map<string, string[]>();
    for (const row of attendanceRows) {
      if (!row.online) continue;
      onlineByMeeting.set(row.meeting_id, [...(onlineByMeeting.get(row.meeting_id) ?? []), row.member_id]);
    }
    const guestRows = (guestResult.data ?? []) as MeetingGuest[];

    const attendanceByMeeting = new Map<string, string[]>();
    for (const row of attendanceRows) {
      const current = attendanceByMeeting.get(row.meeting_id) ?? [];
      current.push(row.member_id);
      attendanceByMeeting.set(row.meeting_id, current);
    }

    const guestsByMeeting = new Map<string, MeetingGuest[]>();
    for (const guest of guestRows) {
      const current = guestsByMeeting.get(guest.meeting_id) ?? [];
      current.push(guest);
      guestsByMeeting.set(guest.meeting_id, current);
    }

    const assembled: Meeting[] = meetingRows.map((meeting) => ({
      ...meeting,
      attendeeIds: attendanceByMeeting.get(meeting.id) ?? [],
      onlineIds: onlineByMeeting.get(meeting.id) ?? [],
      guests: guestsByMeeting.get(meeting.id) ?? [],
    }));

    setMembers(memberRows);
    setMeetings(assembled);
    setAdjustments((adjustmentResult.data ?? []) as SettlementAdjustment[]);
    setPrepayments((prepaymentResult.data ?? []) as MeetingPrepayment[]);
    setProfiles((profileResult.data ?? []) as Profile[]);
    setActivityLogs((activityLogResult.data ?? []) as ActivityLog[]);
    setLoading(false);

    // 봇 점수는 부가 정보라 실패해도 화면 전체를 막지 않는다.
    const pointResult = await supabase
      .from("bot_points")
      .select("kakao_uid,name,exp,rank,trophies,tickets,season,last_active,synced_at");
    setBotPoints(pointResult.error ? [] : ((pointResult.data ?? []) as BotPoint[]));
  }, []);

  const applySignedInUser = useCallback(
    async (userId: string) => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,member_id,nickname,role")
        .eq("id", userId)
        .maybeSingle();

      if (error || !data) {
        setCurrentUserId("");
        setCurrentRole(null);
        setCurrentNickname("");
        setLoginNotice("이 계정은 모임 회원과 연결되어 있지 않습니다.");
        await supabase.auth.signOut();
        return false;
      }

      const profile = data as Profile;
      setCurrentUserId(userId);
      setCurrentRole(profile.role);
      setCurrentNickname(profile.nickname);
      return true;
    },
    []
  );

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // PWA 설치가 지원되지 않는 환경에서는 웹앱으로 그대로 동작합니다.
      });
    }

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    };
  }, []);

  useEffect(() => {
    let alive = true;

    void (async () => {
      try {
        const response = await fetch("/api/setup/status", { cache: "no-store" });
        const body = await response.json();
        if (alive) setOwnerExists(Boolean(body.ownerExists));
      } catch {
        if (alive) setOwnerExists(null);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  async function installApp() {
    if (!installPrompt) {
      setNotice(
        "설치 버튼이 표시되지 않는 경우 브라우저 메뉴의 '홈 화면에 추가' 또는 '앱 설치'를 이용해주세요."
      );
      return;
    }

    await installPrompt.prompt();
    setInstallPrompt(null);
  }

  useEffect(() => {
    let alive = true;

    async function initializeAuth() {
      setAuthLoading(true);
      const { data } = await supabase.auth.getSession();

      if (!alive) return;

      if (data.session?.user?.id) {
        const ok = await applySignedInUser(data.session.user.id);
        if (ok) await loadAll();
      }

      if (alive) setAuthLoading(false);
    }

    void initializeAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      window.setTimeout(() => {
        void (async () => {
          if (!session?.user?.id) {
            setCurrentUserId("");
            setCurrentRole(null);
            setCurrentNickname("");
            setMembers([]);
            setMeetings([]);
            setProfiles([]);
            return;
          }

          const ok = await applySignedInUser(session.user.id);
          if (ok) await loadAll();
        })();
      }, 0);
    });

    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, [applySignedInUser, loadAll]);

  const isAdmin = currentRole === "owner" || currentRole === "admin";
  const lastChats = useLastChats(Boolean(currentRole)); // 이름 → 마지막 채팅 시각 (카톡 봇)
  const isOwner = currentRole === "owner";

  const monthMeetings = useMemo(
    () => meetings.filter((meeting) => meeting.date.startsWith(selectedMonth)),
    [meetings, selectedMonth]
  );

  useEffect(() => {
    const valid = monthMeetings.some((meeting) => meeting.id === selectedMeetingId);
    if (!valid) {
      setSelectedMeetingId(monthMeetings[0]?.id ?? "");
      setMemberFixedDrafts({});
      setGuestFixedDrafts({});
    }
  }, [monthMeetings, selectedMeetingId]);

  const selectedMeeting = useMemo(
    () => meetings.find((meeting) => meeting.id === selectedMeetingId) ?? null,
    [meetings, selectedMeetingId]
  );

  const detailMeeting = useMemo(
    () => meetings.find((meeting) => meeting.id === detailMeetingId) ?? null,
    [meetings, detailMeetingId]
  );

  const activeMembers = useMemo(
    () => members.filter((member) => member.active),
    [members]
  );

  const withdrawnMembers = useMemo(
    () => members.filter((member) => !member.active),
    [members]
  );

  // members.name(짧은 닉네임) ↔ 봇 점수판 짧은 닉네임. 같은 이름이 여럿이면 점수가 높은 쪽.
  const pointsByMember = useMemo(() => {
    const normalize = (value: string) => value.split(" ").join("").toLowerCase();
    const byName = new Map<string, BotPoint>();
    for (const row of botPoints) {
      const key = normalize(row.name);
      const current = byName.get(key);
      if (!current || row.exp > current.exp) byName.set(key, row);
    }
    const map: Record<string, BotPoint> = {};
    for (const member of members) {
      const row = byName.get(normalize(member.name));
      if (row) map[member.id] = row;
    }
    return map;
  }, [botPoints, members]);

  const pointRanking = useMemo(() => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const sorted = [...botPoints].sort((a, b) => b.exp - a.exp || a.name.localeCompare(b.name, "ko"));
    const visible = sorted.filter(
      (row) => !row.last_active || new Date(row.last_active).getTime() >= cutoff,
    );
    return {
      rows: visible.map((row, index) => ({ ...row, place: index + 1 })),
      hidden: sorted.length - visible.length,
      season: sorted[0]?.season ?? null,
    };
  }, [botPoints]);

  const botPointsSyncedAt = useMemo(() => {
    let latest = "";
    for (const row of botPoints) {
      if (row.synced_at > latest) latest = row.synced_at;
    }
    return latest;
  }, [botPoints]);

  const lastAttendanceByMember = useMemo(() => {
    const map: Record<string, string | null> = Object.fromEntries(
      members.map((member) => [member.id, null])
    );

    for (const meeting of meetings) {
      for (const memberId of meeting.attendeeIds) {
        const current = map[memberId];
        if (!current || meeting.date > current) {
          map[memberId] = meeting.date;
        }
      }
    }

    return map;
  }, [members, meetings]);

  // 회원별 참석 횟수 (오늘까지 열린 모든 벙)
  const attendanceCountByMember = useMemo(() => {
    const map: Record<string, number> = {};
    for (const meeting of meetings) {
      if (meeting.date > today) continue;
      for (const memberId of meeting.attendeeIds) {
        map[memberId] = (map[memberId] ?? 0) + 1;
      }
    }
    return map;
  }, [meetings, today]);

  const filteredAttendanceMembers = useMemo(() => {
    // 초성 검색 가능: 'ㅍ' → 푸들·퐁당, 'ㅍㄷ' → 푸들
    const query = attendeeSearch.trim();
    // 게스트로 가입한 사람은 빼고 회원만 (이미 체크된 사람은 해제할 수 있게 남긴다)
    const rows = activeMembers.filter(
      (member) =>
        (!member.is_guest || selectedMeeting?.attendeeIds.includes(member.id)) &&
        (!query || matchesHangul(member.name, query)),
    );

    return [...rows].sort((a, b) => {
      if (attendeeSort === "count_desc") {
        return (attendanceCountByMember[b.id] ?? 0) - (attendanceCountByMember[a.id] ?? 0) || a.name.localeCompare(b.name, "ko");
      }
      if (attendeeSort === "selected_first") {
        const aSelected = selectedMeeting?.attendeeIds.includes(a.id) ? 1 : 0;
        const bSelected = selectedMeeting?.attendeeIds.includes(b.id) ? 1 : 0;
        if (aSelected !== bSelected) return bSelected - aSelected;
        return a.name.localeCompare(b.name, "ko");
      }

      if (attendeeSort === "nickname_asc") {
        return a.name.localeCompare(b.name, "ko");
      }
      if (attendeeSort === "nickname_desc") {
        return b.name.localeCompare(a.name, "ko");
      }
      if (attendeeSort === "join_desc") {
        return b.join_date.localeCompare(a.join_date) || a.name.localeCompare(b.name, "ko");
      }
      if (attendeeSort === "join_asc") {
        return a.join_date.localeCompare(b.join_date) || a.name.localeCompare(b.name, "ko");
      }

      const aLast = lastAttendanceByMember[a.id];
      const bLast = lastAttendanceByMember[b.id];

      if (!aLast && !bLast) return a.name.localeCompare(b.name, "ko");
      if (!aLast) return 1;
      if (!bLast) return -1;

      if (attendeeSort === "last_desc") {
        return bLast.localeCompare(aLast) || a.name.localeCompare(b.name, "ko");
      }

      return aLast.localeCompare(bLast) || a.name.localeCompare(b.name, "ko");
    });
  }, [
    activeMembers,
    attendeeSearch,
    attendeeSort,
    selectedMeeting,
    lastAttendanceByMember,
    attendanceCountByMember,
  ]);

  const sortedSelectedGuests = useMemo(() => {
    if (!selectedMeeting) return [];

    return [...selectedMeeting.guests].sort((a, b) => {
      if (guestSort === "nickname_asc") {
        return a.name.localeCompare(b.name, "ko");
      }
      if (guestSort === "nickname_desc") {
        return b.name.localeCompare(a.name, "ko");
      }
      if (guestSort === "added_desc") {
        return b.created_at.localeCompare(a.created_at) || a.name.localeCompare(b.name, "ko");
      }
      return a.created_at.localeCompare(b.created_at) || a.name.localeCompare(b.name, "ko");
    });
  }, [selectedMeeting, guestSort]);

  const warningByMember = useMemo(() => {
    const map: Record<string, { warning: boolean; text: string }> = {};

    for (const member of members) {
      if (!member.active) {
        map[member.id] = { warning: false, text: "탈퇴 회원" };
        continue;
      }

      const last = lastAttendanceByMember[member.id];
      if (last) {
        const days = daysBetween(last, today);
        map[member.id] =
          days >= 30
            ? { warning: true, text: `최근 참석 후 ${days}일 경과` }
            : { warning: false, text: `최근 참석 ${days}일 전` };
      } else {
        const days = daysBetween(member.join_date, today);
        map[member.id] =
          days >= 14
            ? { warning: true, text: `입장 후 ${days}일간 참석 없음` }
            : { warning: false, text: `첫 참석 대기 ${days}일째` };
      }
    }

    return map;
  }, [members, lastAttendanceByMember, today]);

  const warningMembers = useMemo(
    () => activeMembers.filter((member) => !member.is_guest && warningByMember[member.id]?.warning),
    [activeMembers, warningByMember]
  );

  const guestMembers = useMemo(
    () => members.filter((member) => member.is_guest && member.active).sort((a, b) => b.join_date.localeCompare(a.join_date)),
    [members],
  );

  async function promoteGuest(member: Member) {
    if (!window.confirm(`${member.name}님을 정회원으로 바꿀까요?`)) return;
    const { error } = await supabase.from("members").update({ is_guest: false }).eq("id", member.id);
    if (error) setNotice(`정회원 전환 실패: ${error.message}`);
    else await loadAll();
  }

  const memberStatusCounts = useMemo(() => {
    const activeTotal = members.filter((member) => member.active && !member.is_guest).length;
    const warning = warningMembers.length;
    const active = Math.max(0, activeTotal - warning);

    return {
      all: activeTotal,
      active,
      warning,
      withdrawn: members.filter((member) => !member.active && !member.is_guest).length,
    };
  }, [members, warningMembers]);


  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();

    const rows = members.filter((member) => {
      if (member.is_guest) return false; // 게스트는 아래 '게스트 현황'에 따로
      if (q && !member.name.toLowerCase().includes(q)) return false;
      if (memberFilter === "active") {
        return member.active && !warningByMember[member.id]?.warning;
      }
      if (memberFilter === "withdrawn") return !member.active;
      if (memberFilter === "warning") {
        return member.active && warningByMember[member.id]?.warning;
      }
      return member.active;
    });

    return [...rows].sort((a, b) => {
      if (memberSort === "nickname_asc") {
        return a.name.localeCompare(b.name, "ko");
      }
      if (memberSort === "nickname_desc") {
        return b.name.localeCompare(a.name, "ko");
      }
      if (memberSort === "join_desc") {
        return b.join_date.localeCompare(a.join_date) || a.name.localeCompare(b.name, "ko");
      }
      if (memberSort === "join_asc") {
        return a.join_date.localeCompare(b.join_date) || a.name.localeCompare(b.name, "ko");
      }
      if (memberSort === "chat_desc" || memberSort === "chat_asc") {
        // 채팅 기록이 없는 회원은 항상 뒤로
        const aChat = lastChats[a.name] ?? "";
        const bChat = lastChats[b.name] ?? "";
        if (!aChat || !bChat) return (aChat ? -1 : bChat ? 1 : 0) || a.name.localeCompare(b.name, "ko");
        return (memberSort === "chat_desc" ? bChat.localeCompare(aChat) : aChat.localeCompare(bChat)) || a.name.localeCompare(b.name, "ko");
      }
      if (memberSort === "points_desc") {
        const aExp = pointsByMember[a.id]?.exp ?? -1;
        const bExp = pointsByMember[b.id]?.exp ?? -1;
        return bExp - aExp || a.name.localeCompare(b.name, "ko");
      }

      const aLast = lastAttendanceByMember[a.id];
      const bLast = lastAttendanceByMember[b.id];

      // 참석 기록이 없는 회원은 항상 목록 뒤로 보냅니다.
      if (!aLast && !bLast) return a.name.localeCompare(b.name, "ko");
      if (!aLast) return 1;
      if (!bLast) return -1;

      if (memberSort === "last_desc") {
        return bLast.localeCompare(aLast) || a.name.localeCompare(b.name, "ko");
      }
      return aLast.localeCompare(bLast) || a.name.localeCompare(b.name, "ko");
    });
  }, [
    members,
    memberSearch,
    memberFilter,
    memberSort,
    warningByMember,
    lastAttendanceByMember,
    pointsByMember,
    lastChats,
  ]);

  const adjustmentByKey = useMemo(() => {
    const map: Record<string, SettlementAdjustment> = {};
    for (const item of adjustments) {
      map[`${item.meeting_id}:${item.member_id}`] = item;
    }
    return map;
  }, [adjustments]);

  const prepaymentByKey = useMemo(() => {
    const map: Record<string, MeetingPrepayment> = {};
    for (const item of prepayments) {
      map[`${item.meeting_id}:${item.member_id}`] = item;
    }
    return map;
  }, [prepayments]);

  const selectedPrepaymentByMember = useMemo(() => {
    const map: Record<string, MeetingPrepayment> = {};
    if (!selectedMeeting) return map;

    for (const item of prepayments) {
      if (item.meeting_id === selectedMeeting.id) {
        map[item.member_id] = item;
      }
    }
    return map;
  }, [prepayments, selectedMeeting]);

  const meetingAllocation = useCallback(
    (meeting: Meeting) => {
      const totalCost = meeting.cost == null ? 0 : Number(meeting.cost);

      const fixedMembers = meeting.attendeeIds
        .map((memberId) => {
          const item = adjustmentByKey[`${meeting.id}:${memberId}`];
          return item ? { key: `m:${memberId}`, amount: Number(item.amount) } : null;
        })
        .filter(
          (item): item is { key: string; amount: number } => item !== null
        );

      const fixedGuests = meeting.guests
        .filter((guest) => guest.fixed_amount != null)
        .map((guest) => ({
          key: `g:${guest.id}`,
          amount: Number(guest.fixed_amount),
        }));

      const fixedTotal = [...fixedMembers, ...fixedGuests].reduce(
        (sum, item) => sum + item.amount,
        0
      );

      const normalMemberIds = meeting.attendeeIds.filter(
        (memberId) => !adjustmentByKey[`${meeting.id}:${memberId}`]
      );

      const normalGuests = meeting.guests.filter(
        (guest) => guest.fixed_amount == null
      );

      const normalCount = normalMemberIds.length + normalGuests.length;
      const remaining = Math.max(0, totalCost - fixedTotal);
      const normalShare = normalCount > 0 ? remaining / normalCount : 0;

      const shares: Record<string, number> = {};

      for (const memberId of meeting.attendeeIds) {
        const item = adjustmentByKey[`${meeting.id}:${memberId}`];
        shares[`m:${memberId}`] = item ? Number(item.amount) : normalShare;
      }

      for (const guest of meeting.guests) {
        shares[`g:${guest.id}`] =
          guest.fixed_amount != null ? Number(guest.fixed_amount) : normalShare;
      }

      return {
        totalCost,
        fixedTotal,
        remaining,
        normalCount,
        normalShare,
        shares,
      };
    },
    [adjustmentByKey]
  );

  const selectedAllocation = useMemo(
    () => (selectedMeeting ? meetingAllocation(selectedMeeting) : null),
    [selectedMeeting, meetingAllocation]
  );

  const monthStats = useMemo(() => {
    return members.map((member) => {
      let attendanceCount = 0;
      let expectedAmount = 0;

      for (const meeting of monthMeetings) {
        if (!meeting.attendeeIds.includes(member.id)) continue;
        attendanceCount += 1;
        expectedAmount += meetingAllocation(meeting).shares[`m:${member.id}`] ?? 0;
      }

      return {
        member,
        attendanceCount,
        expectedAmount,
      };
    });
  }, [members, monthMeetings, meetingAllocation]);


  // 알림 대상 = 참석 경고 + 미채팅 3일 이상 (게스트 제외)
  const noticeTargets = activeMembers.filter((member) => {
    if (member.is_guest) return false;
    if (warningByMember[member.id]?.warning) return true;
    const chatAt = lastChats[member.name];
    return Boolean(chatAt) && Date.now() - new Date(chatAt).getTime() >= 3 * 86400000;
  });

  // 📢 참석 안내 알림 (관리자): 봇이 카톡방에 멘션으로 올린다
  async function sendAttendanceNotice(memberIds: string[], label: string) {
    if (memberIds.length === 0) {
      setNotice("알림 보낼 회원을 골라 주세요.");
      return;
    }
    if (!window.confirm(`${label} ${memberIds.length}명에게 카톡방 참석 안내(멘션)를 보낼까요?`)) return;
    setNoticeBusy(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const response = await fetch("/api/notice", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({ memberIds }),
      });
      const json = await response.json().catch(() => ({ ok: false, error: "응답 오류" }));
      setNotice(json.ok ? `📢 ${json.count}명 참석 안내를 보냈어요. (봇이 몇 초 안에 카톡방에 올립니다)` : `알림 실패: ${json.error}`);
      if (json.ok) setNoticePick([]);
    } finally {
      setNoticeBusy(false);
    }
  }

  const sortedMonthStats = useMemo(() => {
    const direction = monthlySortDirection === "asc" ? 1 : -1;

    return [...monthStats].sort((a, b) => {
      let result = 0;

      switch (monthlySortKey) {
        case "member":
          result = a.member.name.localeCompare(b.member.name, "ko");
          break;
        case "status":
          result = Number(b.member.active) - Number(a.member.active);
          break;
        case "join":
          result = a.member.join_date.localeCompare(b.member.join_date);
          break;
        case "attendance":
          result = a.attendanceCount - b.attendanceCount;
          break;
        case "last": {
          const aLast = lastAttendanceByMember[a.member.id];
          const bLast = lastAttendanceByMember[b.member.id];
          if (!aLast && !bLast) result = 0;
          else if (!aLast) return 1;
          else if (!bLast) return -1;
          else result = aLast.localeCompare(bLast);
          break;
        }
        case "burden":
          result = a.expectedAmount - b.expectedAmount;
          break;
        case "warning": {
          const aWarning = Boolean(
            a.member.active && warningByMember[a.member.id]?.warning
          );
          const bWarning = Boolean(
            b.member.active && warningByMember[b.member.id]?.warning
          );
          result = Number(aWarning) - Number(bWarning);
          break;
        }
      }

      if (result === 0) {
        return a.member.name.localeCompare(b.member.name, "ko");
      }
      return result * direction;
    });
  }, [
    monthStats,
    monthlySortDirection,
    monthlySortKey,
    lastAttendanceByMember,
    warningByMember,
  ]);

  function toggleMonthlySort(key: MonthlySortKey) {
    if (monthlySortKey === key) {
      setMonthlySortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setMonthlySortKey(key);
    setMonthlySortDirection(
      key === "attendance" || key === "burden" || key === "warning" || key === "last"
        ? "desc"
        : "asc"
    );
  }

  function monthlySortIndicator(key: MonthlySortKey) {
    if (monthlySortKey !== key) return "↕";
    return monthlySortDirection === "asc" ? "↑" : "↓";
  }

  const monthTotalCost = useMemo(
    () =>
      monthMeetings.reduce(
        (sum, meeting) => sum + (meeting.cost == null ? 0 : Number(meeting.cost)),
        0
      ),
    [monthMeetings]
  );

  const monthAttendanceTotal = useMemo(
    () =>
      monthMeetings.reduce(
        (sum, meeting) => sum + meeting.attendeeIds.length + meeting.guests.length,
        0
      ),
    [monthMeetings]
  );

  const monthGuestTotal = useMemo(
    () => monthMeetings.reduce((sum, meeting) => sum + meeting.guests.length, 0),
    [monthMeetings]
  );


  const selectedMeetingPrepaymentTotal = useMemo(() => {
    if (!selectedMeeting) return 0;
    return prepayments
      .filter((item) => item.meeting_id === selectedMeeting.id)
      .reduce((sum, item) => sum + Number(item.amount), 0);
  }, [prepayments, selectedMeeting]);

  const currentProfile = useMemo(
    () => profiles.find((profile) => profile.id === currentUserId) ?? null,
    [profiles, currentUserId]
  );

  const currentMember = useMemo(
    () =>
      currentProfile
        ? members.find((member) => member.id === currentProfile.member_id) ?? null
        : null,
    [members, currentProfile]
  );

  useEffect(() => {
    if (!gameInvite || !currentMember) return;
    setShowGames(true);
  }, [gameInvite, currentMember]);

  const myMonthSummary = useMemo(() => {
    if (!currentMember) {
      return { attendance: 0, burden: 0 };
    }

    let attendance = 0;
    let burden = 0;

    for (const meeting of monthMeetings) {
      if (!meeting.attendeeIds.includes(currentMember.id)) continue;

      attendance += 1;
      const share = meetingAllocation(meeting).shares[`m:${currentMember.id}`] ?? 0;
      burden += share;
    }

    return { attendance, burden };
  }, [currentMember, monthMeetings, meetingAllocation]);

  const myMeetingRows = useMemo(() => {
    if (!currentMember) return [];

    return monthMeetings
      .filter((meeting) => meeting.attendeeIds.includes(currentMember.id))
      .map((meeting) => ({
        meeting,
        share: meetingAllocation(meeting).shares[`m:${currentMember.id}`] ?? 0,
      }))
      .sort((a, b) => b.meeting.date.localeCompare(a.meeting.date));
  }, [currentMember, monthMeetings, meetingAllocation]);

  const myAllMeetings = useMemo(() => {
    if (!currentMember) return [];
    return meetings.filter((meeting) => meeting.attendeeIds.includes(currentMember.id)).sort((a,b) => b.date.localeCompare(a.date));
  }, [currentMember, meetings]);

  const myUpcomingMeetings = useMemo(() =>
    myAllMeetings.filter((meeting) => meeting.date >= today).sort((a,b) => a.date.localeCompare(b.date)).slice(0, 3),
    [myAllMeetings, today]
  );

  const memberDetail = useMemo(
    () => members.find((member) => member.id === memberDetailId) ?? null,
    [members, memberDetailId]
  );

  const memberDetailProfile = useMemo(
    () =>
      memberDetail
        ? profiles.find((profile) => profile.member_id === memberDetail.id) ?? null
        : null,
    [profiles, memberDetail]
  );

  const memberDetailMeetings = useMemo(() => {
    if (!memberDetail) return [];
    return meetings
      .filter((meeting) => meeting.attendeeIds.includes(memberDetail.id))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [meetings, memberDetail]);


  const meetingCalendarCells = useMemo(
    () => calendarDates(meetingCalendarMonth),
    [meetingCalendarMonth]
  );

  const meetingsByDate = useMemo(() => {
    const map = new Map<string, Meeting[]>();
    for (const meeting of meetings) {
      const items = map.get(meeting.date) ?? [];
      items.push(meeting);
      map.set(meeting.date, items);
    }
    for (const items of map.values()) {
      items.sort((a, b) => a.title.localeCompare(b.title, "ko"));
    }
    return map;
  }, [meetings]);

  const selectedCalendarMeetings = useMemo(() => meetingsByDate.get(selectedCalendarDate) ?? [], [meetingsByDate, selectedCalendarDate]);

  const memberCalendarCells = useMemo(
    () => calendarDates(memberCalendarMonth),
    [memberCalendarMonth]
  );

  const memberMeetingsByDate = useMemo(() => {
    const map = new Map<string, Meeting[]>();
    for (const meeting of memberDetailMeetings) {
      const items = map.get(meeting.date) ?? [];
      items.push(meeting);
      map.set(meeting.date, items);
    }
    return map;
  }, [memberDetailMeetings]);

  const uniqueMonthParticipants = useMemo(() => {
    const ids = new Set<string>();
    for (const meeting of monthMeetings) {
      for (const memberId of meeting.attendeeIds) ids.add(memberId);
    }
    return ids.size;
  }, [monthMeetings]);

  const topAttendance = useMemo(() => {
    const sorted = [...monthStats]
      .filter((item) => item.attendanceCount > 0)
      .sort((a, b) => b.attendanceCount - a.attendanceCount || a.member.name.localeCompare(b.member.name))
      .slice(0, 5);

    return sorted.map((item) => ({
      ...item,
      displayRank:
        sorted.findIndex((candidate) => candidate.attendanceCount === item.attendanceCount) + 1,
    }));
  }, [monthStats]);

  const costMissingMeetings = useMemo(
    () => monthMeetings.filter((meeting) => meeting.cost == null),
    [monthMeetings]
  );

  const completedCostMeetings = monthMeetings.length - costMissingMeetings.length;

  const operationsStats = useMemo(() => {
    const active = members.filter(m => m.active && !m.is_guest);
    const joinedThisMonth = active.filter(m => m.join_date.startsWith(selectedMonth));
    const joinedWithAttendance = joinedThisMonth.filter(m => meetings.some(meeting => meeting.attendeeIds.includes(m.id)));
    const participationRate = active.length ? Math.round((uniqueMonthParticipants / active.length) * 100) : 0;
    const settleRate = monthMeetings.length ? Math.round((completedCostMeetings / monthMeetings.length) * 100) : 0;
    return { joined: joinedThisMonth.length, settled: joinedWithAttendance.length, participationRate, settleRate };
  }, [members, meetings, selectedMonth, uniqueMonthParticipants, monthMeetings.length, completedCostMeetings]);


  const averageMeetingAttendance = useMemo(
    () =>
      monthMeetings.length > 0
        ? monthAttendanceTotal / monthMeetings.length
        : 0,
    [monthMeetings, monthAttendanceTotal]
  );

  const averageMeetingCost = useMemo(
    () =>
      completedCostMeetings > 0
        ? monthTotalCost / completedCostMeetings
        : 0,
    [completedCostMeetings, monthTotalCost]
  );

  const popularMeetings = useMemo(() => {
    const sorted = [...monthMeetings]
        .map((meeting) => {
          const memberAttendees = meeting.attendeeIds.length;
          const totalAttendees = memberAttendees + meeting.guests.length;
          const attendanceRate =
            activeMembers.length > 0
              ? Math.min(100, Math.round((memberAttendees / activeMembers.length) * 100))
              : 0;

          return {
            meeting,
            memberAttendees,
            totalAttendees,
            attendanceRate,
          };
        })
        .sort(
          (a, b) =>
            b.totalAttendees - a.totalAttendees ||
            b.memberAttendees - a.memberAttendees ||
            b.meeting.date.localeCompare(a.meeting.date)
        )
        .slice(0, 5);

    return sorted.map((item) => ({
      ...item,
      displayRank:
        sorted.findIndex((candidate) => candidate.totalAttendees === item.totalAttendees) + 1,
    }));
  }, [monthMeetings, activeMembers]);

  const monthBirthdays = useMemo(() => {
    const targetMonth = selectedMonth.slice(5, 7);

    return members
      .filter(
        (member) =>
          member.active &&
          !member.is_guest &&
          member.birthday &&
          member.birthday.slice(5, 7) === targetMonth
      )
      .sort((a, b) => {
        const aDay = a.birthday?.slice(8, 10) ?? "99";
        const bDay = b.birthday?.slice(8, 10) ?? "99";
        return aDay.localeCompare(bDay) || a.name.localeCompare(b.name, "ko");
      });
  }, [members, selectedMonth]);



  async function logActivity(
    action: string,
    entityType: string,
    entityId: string | null,
    description: string
  ) {
    if (!currentUserId || !currentNickname) return;

    const { error } = await supabase.from("activity_logs").insert({
      actor_id: currentUserId,
      actor_nickname: currentNickname,
      action,
      entity_type: entityType,
      entity_id: entityId,
      description,
    });

    if (error) {
      console.warn("변경 이력 기록 실패:", error.message);
    }
  }

  async function changeMyPassword() {
    if (newPassword.length < 6) {
      setNotice("새 비밀번호는 6자 이상으로 입력해주세요.");
      return;
    }

    if (newPassword !== newPasswordConfirm) {
      setNotice("새 비밀번호 확인이 일치하지 않습니다.");
      return;
    }

    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });

    if (error) {
      setNotice(`비밀번호 변경 실패: ${error.message}`);
    } else {
      setNotice("비밀번호를 변경했습니다.");
      setNewPassword("");
      setNewPasswordConfirm("");
      setShowAccountPanel(false);
      await logActivity("비밀번호 변경", "account", currentUserId, "본인 비밀번호 변경");
    }

    setSaving(false);
  }

  async function loadPetLinkStatus() {
  setPetLinkLoading(true);
  setPetLinkError("");

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token ?? "";

    if (!accessToken) {
      setPetLinkStatus(null);
      setPetLinkError("로그인 세션을 확인할 수 없습니다.");
      return;
    }

    const response = await fetch("/api/pet/link", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    });

    const result = await response.json().catch(() => null);

    if (!response.ok) {
      setPetLinkStatus(null);
      setPetLinkError(
        result?.error ?? "PET 연동 상태를 확인하지 못했습니다."
      );
      return;
    }

    setPetLinkStatus({
      linked: Boolean(result?.linked),
      externalMemberId: result?.externalMemberId,
      externalNickname: result?.externalNickname,
      profileId: result?.profileId,
      petNickname: result?.petNickname,
      linkedAt: result?.linkedAt,
      meetingNickname:
        result?.meetingNickname ?? currentNickname,
    });
  } catch (error) {
    console.error("[PET_LINK_STATUS]", error);
    setPetLinkStatus(null);
    setPetLinkError("PET 연동 서버와 통신하지 못했습니다.");
  } finally {
    setPetLinkLoading(false);
  }
}

async function linkMyPetAccount() {
  if (petLinkSubmitting) return;

  setPetLinkSubmitting(true);
  setPetLinkError("");

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token ?? "";

    if (!accessToken) {
      setPetLinkError("로그인 세션을 확인할 수 없습니다.");
      return;
    }

    const response = await fetch("/api/pet/link", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const result = await response.json().catch(() => null);

    if (!response.ok) {
      setPetLinkError(
        result?.error ?? "PET 계정을 연동하지 못했습니다."
      );
      return;
    }

    setPetLinkStatus({
      linked: true,
      externalMemberId: result?.externalMemberId,
      externalNickname:
        result?.externalNickname ?? currentNickname,
      profileId: result?.profileId,
      petNickname: result?.nickname ?? currentNickname,
      linkedAt: result?.linkedAt,
      meetingNickname:
        result?.meetingNickname ?? currentNickname,
    });

    setNotice(
      result?.alreadyLinked
        ? "이미 PET 계정과 연동되어 있습니다."
        : "PET 계정 연동이 완료되었습니다."
    );
  } catch (error) {
    console.error("[PET_LINK_SUBMIT]", error);
    setPetLinkError("PET 연동 서버와 통신하지 못했습니다.");
  } finally {
    setPetLinkSubmitting(false);
  }
}

  type CreatedAttendanceForPet = {
  member_id: string;
};

async function notifyPetAttendances(
  meetingId: string,
  attendances: CreatedAttendanceForPet[]
) {
  if (attendances.length === 0) return;

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token ?? "";

  if (!accessToken) {
    console.warn(
      "[PET_ATTENDANCE] 로그인 세션을 확인할 수 없어 PET 보상을 요청하지 않았습니다."
    );
    return;
  }

  const results = await Promise.allSettled(
    attendances.map(async (attendance) => {
      const response = await fetch("/api/pet/attendance", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          externalMemberId: attendance.member_id,
          meetingId,
        }),
      });

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          result?.error ??
            `PET attendance reward failed (${response.status})`
        );
      }

      return result;
    })
  );

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.warn(
        "[PET_ATTENDANCE] reward notification failed",
        {
          meetingId,
          memberId: attendances[index]?.member_id,
          reason: result.reason,
        }
      );
    }
  });
}

async function setAttendanceMembers(memberIds: string[]) {
  if (!selectedMeeting || saving) return;

  setSaving(true);
  setNotice("");

  const currentIds = new Set(selectedMeeting.attendeeIds);
  const nextIds = new Set(memberIds);

  const toAdd = memberIds.filter((id) => !currentIds.has(id));
  const toRemove = selectedMeeting.attendeeIds.filter(
    (id) => !nextIds.has(id)
  );

  /*
   * 참석 해제 회원의 정산 관련 데이터 정리
   */
  const cleanupTasks = toRemove.flatMap((memberId) => [
    supabase
      .from("settlement_adjustments")
      .delete()
      .eq("meeting_id", selectedMeeting.id)
      .eq("member_id", memberId),

    supabase
      .from("meeting_prepayments")
      .delete()
      .eq("meeting_id", selectedMeeting.id)
      .eq("member_id", memberId),
  ]);

  const cleanupResults = await Promise.all(cleanupTasks);
  const cleanupError = cleanupResults.find(
    (result) => result.error
  )?.error;

  if (cleanupError) {
    setNotice(`참석 일괄 변경 실패: ${cleanupError.message}`);
    setSaving(false);
    return;
  }

  /*
   * 기존 참석 해제
   */
  if (toRemove.length > 0) {
    const { error: removeError } = await supabase
      .from("attendance")
      .delete()
      .eq("meeting_id", selectedMeeting.id)
      .in("member_id", toRemove);

    if (removeError) {
      setNotice(`참석 일괄 변경 실패: ${removeError.message}`);
      setSaving(false);
      return;
    }
  }

  /*
   * 신규 참석 추가
   *
   * DB에서 생성된 실제 created_at을 반환받아
   * PET 연동에 사용한다.
   */
  let createdAttendances: CreatedAttendanceForPet[] = [];

  if (toAdd.length > 0) {
    const { data, error: addError } = await supabase
      .from("attendance")
      .insert(
        toAdd.map((memberId) => ({
          meeting_id: selectedMeeting.id,
          member_id: memberId,
        }))
      )
      .select("member_id, created_at");

    if (addError) {
      setNotice(`참석 일괄 변경 실패: ${addError.message}`);
      setSaving(false);
      await loadAll();
      return;
    }

    createdAttendances =
      (data as CreatedAttendanceForPet[] | null) ?? [];
  }

  /*
   * 여기까지 왔다면 attendance 저장은 성공한 상태.
   *
   * PET 연동은 별도 처리하므로 PET 서버 장애가
   * 모임 참석 저장 성공 여부에 영향을 주지 않는다.
   */
  if (createdAttendances.length > 0) {
    await notifyPetAttendances(
      selectedMeeting.id,
      createdAttendances
    );
  }

  await logActivity(
    "참석 일괄 변경",
    "meeting",
    selectedMeeting.id,
    `${selectedMeeting.title} 참석자 ${selectedMeeting.attendeeIds.length}명 → ${memberIds.length}명`
  );

  await loadAll();
  setSaving(false);
}

  async function loadPreviousMeetingAttendees() {
    if (!selectedMeeting) return;

    const previous = meetings
      .filter((meeting) => meeting.date < selectedMeeting.date && meeting.id !== selectedMeeting.id)
      .sort((a, b) => b.date.localeCompare(a.date))[0];

    if (!previous) {
      setNotice("불러올 이전 모임이 없습니다.");
      return;
    }

    if (
      !window.confirm(
        `${previous.date} · ${previous.title} 참석자 ${previous.attendeeIds.length}명을 불러올까요?`
      )
    ) {
      return;
    }

    await setAttendanceMembers(previous.attendeeIds.filter((id) =>
      activeMembers.some((member) => member.id === id)
    ));
  }

  function csvEscape(value: string | number) {
    const text = String(value ?? "");
    return `"${text.replaceAll('"', '""')}"`;
  }

  function downloadTextFile(filename: string, content: string, type: string) {
    const blob = new Blob(["\uFEFF", content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function exportMonthlyCsv() {
    const rows = [
      ["회원", "상태", "입장일", "월 참석", "최근 참석", "벙비 합계"],
      ...monthStats.map(({ member, attendanceCount, expectedAmount }) => [
        member.name,
        member.active ? "활동중" : "탈퇴",
        member.join_date,
        attendanceCount,
        lastAttendanceByMember[member.id] ?? "",
        Math.round(expectedAmount),
      ]),
    ];

    const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\\r\\n");
    downloadTextFile(
      `찐친_${selectedMonth}_월별현황.csv`,
      csv,
      "text/csv;charset=utf-8"
    );
  }

  function exportBackupJson() {
    if (!isAdmin) {
      setNotice("전체 백업은 관리자 이상만 사용할 수 있습니다.");
      return;
    }

    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      members,
      meetings,
      adjustments,
      prepayments,
      activityLogs,
      note: "profiles/auth/PET credentials are intentionally excluded",
    };

    downloadTextFile(
      `찐친_백업_${today}.json`,
      JSON.stringify(data, null, 2),
      "application/json;charset=utf-8"
    );
  }

  async function restoreBackupJson(file: File) {
    if (!isAdmin) {
      setNotice("백업 복원은 관리자 이상만 사용할 수 있습니다.");
      return;
    }
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || !Array.isArray(parsed.members) || !Array.isArray(parsed.meetings)) {
        throw new Error("지원하지 않는 백업 파일입니다.");
      }
      if (!window.confirm(`백업 ${parsed.exportedAt ?? "파일"}을 현재 데이터에 병합 복원할까요?\n기존 로그인/PET 계정은 변경하지 않습니다.`)) return;
      setSaving(true);
      const memberRows = parsed.members.map((m: any) => ({
        id:m.id, name:m.name, active:m.active, join_date:m.join_date, birthday:m.birthday ?? null,
        withdrawn_at:m.withdrawn_at ?? null, created_at:m.created_at, is_guest:m.is_guest ?? false,
      }));
      const meetingRows = parsed.meetings.map((m: any) => ({id:m.id,date:m.date,title:m.title,cost:m.cost,created_at:m.created_at}));
      const attendanceRows = parsed.meetings.flatMap((m: any) => (m.attendeeIds ?? []).map((member_id:string) => ({meeting_id:m.id,member_id})));
      const guestRows = parsed.meetings.flatMap((m:any) => (m.guests ?? []).map((g:any) => ({id:g.id,meeting_id:m.id,name:g.name,fixed_amount:g.fixed_amount ?? null,created_at:g.created_at})));
      const adjustmentRows = Array.isArray(parsed.adjustments) ? parsed.adjustments : [];
      const prepaymentRows = Array.isArray(parsed.prepayments) ? parsed.prepayments : [];
      for (const [table, rows] of [["members",memberRows],["meetings",meetingRows],["attendance",attendanceRows],["meeting_guests",guestRows],["settlement_adjustments",adjustmentRows],["meeting_prepayments",prepaymentRows]] as const) {
        if (!rows.length) continue;
        const { error } = await supabase.from(table).upsert(rows as any);
        if (error) throw new Error(`${table}: ${error.message}`);
      }
      await loadAll();
      setNotice("백업을 병합 복원했습니다. 로그인/PET 계정은 유지됩니다.");
    } catch (error:any) {
      setNotice(`백업 복원 실패: ${error?.message ?? "파일을 확인해주세요."}`);
    } finally {
      setSaving(false);
      if (backupRestoreInputRef.current) backupRestoreInputRef.current.value = "";
    }
  }

  function buildSettlementShareText(meeting: Meeting) {
    if (meeting.cost == null) return "";

    const allocation = meetingAllocation(meeting);
    const rows = meeting.attendeeIds
      .map((memberId) => {
        const member = members.find((item) => item.id === memberId);
        if (!member) return null;

        const share = allocation.shares[`m:${memberId}`] ?? 0;
        const paid = Number(prepaymentByKey[`${meeting.id}:${memberId}`]?.amount ?? 0);
        const remaining = Math.max(0, share - paid);

        return { name: member.name, share, paid, remaining, guest: false };
      })
      .filter(Boolean) as {
      name: string;
      share: number;
      paid: number;
      remaining: number;
      guest: boolean;
    }[];

    const guestRows = meeting.guests.map((guest) => ({
      name: guest.name,
      share: allocation.shares[`g:${guest.id}`] ?? 0,
      paid: 0,
      remaining: allocation.shares[`g:${guest.id}`] ?? 0,
      guest: true,
    }));

    const allRows = [...rows, ...guestRows];

    return [
      `📌 강서구 찐친만들기 벙비 정산`,
      `━━━━━━━━━━━━━━`,
      `📅 ${meeting.date}`,
      `🍻 ${meeting.title}`,
      `💰 총 비용 ${won(Number(meeting.cost))}`,
      `👥 ${allRows.length}명`,
      "",
      ...allRows.map((row) => {
        if (row.guest) return `• ${row.name}(게스트) : ${won(row.remaining)}`;
        if (row.paid > 0) {
          return `• ${row.name} : ${won(row.share)} / 선입금 ${won(row.paid)} → ${won(row.remaining)}`;
        }
        return `• ${row.name} : ${won(row.remaining)}`;
      }),
      "",
      `━━━━━━━━━━━━━━`,
      `벙비 확인 부탁드립니다 🙌`,
    ].join("\n");
  }

  async function shareSettlement(meeting: Meeting) {
    const text = buildSettlementShareText(meeting);
    if (!text) {
      setNotice("먼저 모임 비용을 입력해주세요.");
      return;
    }

    try {
      if (navigator.share) {
        await navigator.share({
          title: `${meeting.title} 벙비 정산`,
          text,
        });
        return;
      }

      await navigator.clipboard.writeText(text);
      setNotice("정산 내용을 복사했습니다. 카카오톡 채팅방에 붙여넣어주세요.");
    } catch (error) {
      if ((error as Error)?.name === "AbortError") return;

      try {
        await navigator.clipboard.writeText(text);
        setNotice("정산 내용을 복사했습니다. 카카오톡 채팅방에 붙여넣어주세요.");
      } catch {
        setNotice("공유에 실패했습니다. 다시 시도해주세요.");
      }
    }
  }

  async function login() {
    const nickname = loginNickname.trim();
    if (!nickname || !loginPassword) {
      setLoginNotice("닉네임과 비밀번호를 입력해주세요.");
      return;
    }

    setLoginNotice("");
    setAuthLoading(true);

    try {
      const lookup = await fetch("/api/auth/nickname", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname }),
      });

      const lookupBody = await lookup.json();
      if (!lookup.ok) {
        setLoginNotice(lookupBody.error ?? "로그인 정보를 확인해주세요.");
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: lookupBody.email,
        password: loginPassword,
      });

      if (error) {
        setLoginNotice("닉네임 또는 비밀번호가 올바르지 않습니다.");
        return;
      }

      setLoginPassword("");
    } catch {
      setLoginNotice("로그인 처리 중 오류가 발생했습니다.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function signup() {
    const nickname = signupNickname.trim();

    if (!nickname || !signupBirthday || signupPassword.length < 6) {
      setLoginNotice("닉네임, 생일, 6자 이상 비밀번호를 입력해주세요.");
      return;
    }

    if (signupBirthday > today) {
      setLoginNotice("생일은 오늘 이후 날짜로 입력할 수 없습니다.");
      return;
    }

    if (signupPassword !== signupPasswordConfirm) {
      setLoginNotice("비밀번호 확인이 일치하지 않습니다.");
      return;
    }

    setAuthLoading(true);
    setLoginNotice("");

    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname,
          birthday: signupBirthday,
          password: signupPassword,
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        setLoginNotice(body.error ?? "가입에 실패했습니다.");
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: body.email,
        password: signupPassword,
      });

      if (error) {
        setAuthMode("login");
        setLoginNickname(nickname);
        setLoginNotice("가입은 완료되었습니다. 방금 만든 비밀번호로 로그인해주세요.");
        return;
      }

      setSignupBirthday("");
      setSignupPassword("");
      setSignupPasswordConfirm("");
      if (body.guest) {
        setNotice("카톡방 명단에서 닉네임을 찾지 못해 게스트로 가입되었어요. 방에 규칙 닉네임으로 들어오면 회원으로 바뀝니다.");
      }
    } catch {
      setLoginNotice("가입 처리 중 오류가 발생했습니다.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    setMainTab("dashboard");
  }

  async function setupCreator() {
    if (!creatorSetupKey.trim() || !creatorNickname.trim()) {
      setLoginNotice("설정키와 제작자 닉네임을 입력해주세요.");
      return;
    }

    setAuthLoading(true);
    setLoginNotice("");

    try {
      const response = await fetch("/api/setup/creator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          setupKey: creatorSetupKey,
          nickname: creatorNickname.trim(),
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        setLoginNotice(body.error ?? "제작자 설정에 실패했습니다.");
        return;
      }

      setShowCreatorSetup(false);
      setOwnerExists(true);
      setCreatorSetupKey("");
      setAuthMode("login");
      setLoginNickname(creatorNickname.trim());
      setLoginNotice("제작자 권한이 지정되었습니다. 기존 비밀번호로 로그인해주세요.");
    } catch {
      setLoginNotice("제작자 설정 중 오류가 발생했습니다.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function changeMemberRole(memberId: string, role: "admin" | "user") {
    if (!isOwner) {
      setNotice("관리자 지정은 제작자만 가능합니다.");
      return;
    }

    const profile = profiles.find((item) => item.member_id === memberId);
    if (!profile) {
      setNotice("먼저 해당 회원의 로그인 계정을 설정해주세요.");
      return;
    }

    if (profile.role === "owner") {
      setNotice("제작자 권한은 변경할 수 없습니다.");
      return;
    }

    const { error } = await supabase
      .from("profiles")
      .update({ role })
      .eq("id", profile.id);

    if (error) setNotice(`권한 변경 실패: ${error.message}`);
    else {
      await logActivity(
        role === "admin" ? "관리자 지정" : "관리자 해제",
        "member",
        memberId,
        `${profile.nickname} 님을 ${role === "admin" ? "관리자로 지정" : "일반 회원으로 변경"}`
      );
      await loadAll();
    }
  }

  async function addMemberByAdmin() {
    if (!isAdmin) {
      setNotice("회원 추가는 관리자 이상만 가능합니다.");
      return;
    }

    const name = newMemberName.trim();
    if (name.length < 2 || name.length > 20) {
      setNotice("회원 닉네임은 2~20자로 입력해주세요.");
      return;
    }

    if (!newMemberJoinDate) {
      setNotice("입장일을 선택해주세요.");
      return;
    }

    const duplicate = members.some(
      (member) => member.name.trim().toLowerCase() === name.toLowerCase()
    );
    if (duplicate) {
      setNotice("이미 등록된 닉네임입니다.");
      return;
    }

    if (saving) return;
    setSaving(true);
    setNotice("");

    const { data, error } = await supabase
      .from("members")
      .insert({
        name,
        active: true,
        join_date: newMemberJoinDate,
        birthday: newMemberBirthday || null,
        withdrawn_at: null,
      })
      .select("id")
      .single();

    if (error || !data) {
      setNotice(`회원 추가 실패: ${error?.message ?? "등록 결과를 확인할 수 없습니다."}`);
      setSaving(false);
      return;
    }

    await logActivity(
      "회원 추가",
      "member",
      data.id,
      `${name} 님을 회원 명단에 추가 · 입장일 ${newMemberJoinDate}`
    );

    setNewMemberName("");
    setNewMemberJoinDate(today);
    setNewMemberBirthday("");
    setNotice(
      `${name} 님을 추가했습니다. 로그인 계정은 해당 회원이 '최초 가입'을 하면 자동 연결됩니다.`
    );
    await loadAll();
    setSaving(false);
  }

  async function getAccessTokenForAdminAction() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? "";
  }

  async function saveMemberNickname(member: Member) {
    if (!isAdmin) {
      setNotice("닉네임 수정은 관리자 이상만 가능합니다.");
      return;
    }

    const nickname = editingNickname.trim();
    if (nickname.length < 2 || nickname.length > 20) {
      setNotice("닉네임은 2~20자로 입력해주세요.");
      return;
    }

    if (nickname === member.name) {
      setEditingNicknameId("");
      setEditingNickname("");
      return;
    }

    if (saving) return;
    setSaving(true);
    setNotice("");

    try {
      const accessToken = await getAccessTokenForAdminAction();
      if (!accessToken) {
        setNotice("로그인 세션을 확인할 수 없습니다. 다시 로그인해주세요.");
        return;
      }

      const response = await fetch("/api/admin/member", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          memberId: member.id,
          nickname,
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        setNotice(body.error ?? "닉네임 수정에 실패했습니다.");
        return;
      }

      const oldName = member.name;
      setEditingNicknameId("");
      setEditingNickname("");

      if (currentMember?.id === member.id) {
        setCurrentNickname(nickname);
      }

      await logActivity(
        "닉네임 수정",
        "member",
        member.id,
        `${oldName} → ${nickname}`
      );
      await loadAll();
      setNotice(`${oldName} 님의 닉네임을 ${nickname}(으)로 변경했습니다.`);
    } catch {
      setNotice("닉네임 수정 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function resetMemberPasswordByAdmin(member: Member) {
    if (!isAdmin) {
      setNotice("비밀번호 재설정은 관리자 이상만 가능합니다.");
      return;
    }

    const targetProfile = profiles.find((item) => item.member_id === member.id);
    if (!targetProfile) {
      setNotice("아직 최초 가입을 하지 않은 회원이라 로그인 계정이 없습니다.");
      return;
    }

    if (currentMember?.id === member.id) {
      setNotice("본인 비밀번호는 상단 '내 계정'에서 변경해주세요.");
      return;
    }

    if (targetProfile.role === "owner") {
      setNotice("제작자 계정의 비밀번호는 관리자 화면에서 재설정할 수 없습니다.");
      return;
    }

    if (currentRole === "admin" && targetProfile.role === "admin") {
      setNotice("관리자는 다른 관리자의 비밀번호를 재설정할 수 없습니다.");
      return;
    }

    if (adminResetPassword.length < 6 || adminResetPassword.length > 72) {
      setNotice("새 비밀번호는 6~72자로 입력해주세요.");
      return;
    }

    if (adminResetPassword !== adminResetPasswordConfirm) {
      setNotice("새 비밀번호 확인이 일치하지 않습니다.");
      return;
    }

    if (
      !window.confirm(
        `${member.name} 님의 로그인 비밀번호를 새 비밀번호로 재설정할까요?\n\n기존 비밀번호는 확인하거나 복구할 수 없습니다.`
      )
    ) {
      return;
    }

    if (saving) return;
    setSaving(true);
    setNotice("");

    try {
      const accessToken = await getAccessTokenForAdminAction();
      if (!accessToken) {
        setNotice("로그인 세션을 확인할 수 없습니다. 다시 로그인해주세요.");
        return;
      }

      const response = await fetch("/api/admin/member", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          action: "reset-password",
          memberId: member.id,
          password: adminResetPassword,
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        setNotice(body.error ?? "비밀번호 재설정에 실패했습니다.");
        return;
      }

      setAdminResetPassword("");
      setAdminResetPasswordConfirm("");

      await logActivity(
        "비밀번호 재설정",
        "member",
        member.id,
        `${member.name} 회원 로그인 비밀번호 재설정`
      );

      setNotice(`${member.name} 님의 로그인 비밀번호를 재설정했습니다.`);
    } catch {
      setNotice("비밀번호 재설정 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteMemberByAdmin(member: Member) {
    if (!isAdmin) {
      setNotice("회원 삭제는 관리자 이상만 가능합니다.");
      return;
    }

    const profile = profiles.find((item) => item.member_id === member.id);

    if (
      !window.confirm(
        `${member.name} 회원을 완전히 삭제할까요?\n\n참석 기록, 특정값, 선입금 등 이 회원과 연결된 데이터도 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다.`
      )
    ) {
      return;
    }

    if (
      !window.confirm(
        `정말 삭제하시겠습니까?\n\n삭제 대상: ${member.name}${profile ? ` (${profile.role === "admin" ? "관리자" : profile.role === "owner" ? "제작자" : "회원"})` : ""}`
      )
    ) {
      return;
    }

    if (saving) return;
    setSaving(true);
    setNotice("");

    try {
      const accessToken = await getAccessTokenForAdminAction();
      if (!accessToken) {
        setNotice("로그인 세션을 확인할 수 없습니다. 다시 로그인해주세요.");
        return;
      }

      const response = await fetch("/api/admin/member", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ memberId: member.id }),
      });
      const body = await response.json();

      if (!response.ok) {
        setNotice(body.error ?? "회원 삭제에 실패했습니다.");
        return;
      }

      await logActivity(
        "회원 삭제",
        "member",
        null,
        `${member.name} 회원 완전 삭제`
      );

      if (memberDetailId === member.id) setMemberDetailId("");
      setEditingNicknameId("");
      setEditingNickname("");
      setEditingJoinId("");
      setEditingJoinDate("");
      await loadAll();
      setNotice(`${member.name} 회원을 삭제했습니다.`);
    } catch {
      setNotice("회원 삭제 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleMemberStatus(member: Member) {
    if (!isAdmin) {
      setNotice("회원 탈퇴/복귀 처리는 관리자만 가능합니다.");
      return;
    }

    const nextActive = !member.active;
    if (
      !window.confirm(
        `${member.name} 회원을 ${nextActive ? "활동중" : "탈퇴"} 상태로 변경할까요?`
      )
    ) {
      return;
    }

    setSaving(true);
    const { error } = await supabase
      .from("members")
      .update({
        active: nextActive,
        withdrawn_at: nextActive ? null : today,
      })
      .eq("id", member.id);

    if (error) setNotice(`상태 변경 실패: ${error.message}`);
    else {
      await logActivity(
        nextActive ? "회원 복귀" : "회원 탈퇴",
        "member",
        member.id,
        `${member.name} 님을 ${nextActive ? "활동중" : "탈퇴"} 상태로 변경`
      );
      await loadAll();
    }
    setSaving(false);
  }

  async function saveJoinDate(memberId: string) {
    if (!isAdmin) {
      setNotice("입장일 수정은 관리자만 가능합니다.");
      return;
    }

    if (!editingJoinDate || saving) return;
    setSaving(true);

    const { error } = await supabase
      .from("members")
      .update({ join_date: editingJoinDate })
      .eq("id", memberId);

    if (error) setNotice(`입장일 수정 실패: ${error.message}`);
    else {
      const member = members.find((item) => item.id === memberId);
      await logActivity(
        "입장일 수정",
        "member",
        memberId,
        `${member?.name ?? "회원"} 입장일을 ${editingJoinDate}로 수정`
      );
      setEditingJoinId("");
      setEditingJoinDate("");
      await loadAll();
    }
    setSaving(false);
  }

  async function saveBirthday(memberId: string) {
    if (!isAdmin) {
      setNotice("생일 수정은 관리자만 가능합니다.");
      return;
    }

    if (editingBirthday && editingBirthday > today) {
      setNotice("생일은 오늘 이후 날짜로 입력할 수 없습니다.");
      return;
    }

    if (saving) return;
    setSaving(true);

    const { error } = await supabase
      .from("members")
      .update({ birthday: editingBirthday || null })
      .eq("id", memberId);

    if (error) setNotice(`생일 수정 실패: ${error.message}`);
    else {
      const member = members.find((item) => item.id === memberId);
      await logActivity(
        "생일 수정",
        "member",
        memberId,
        `${member?.name ?? "회원"} 생일을 ${editingBirthday || "미입력"}(으)로 수정`
      );
      setEditingBirthdayId("");
      setEditingBirthday("");
      await loadAll();
      setNotice(`${member?.name ?? "회원"} 님의 생일을 수정했습니다.`);
    }
    setSaving(false);
  }

  async function addMeeting() {
    if (!newMeetingDate || !newMeetingTitle.trim() || saving) return;
    setSaving(true);
    setNotice("");

    const { data, error } = await supabase
      .from("meetings")
      .insert({
        date: newMeetingDate,
        title: newMeetingTitle.trim(),
        cost: null,
      })
      .select("id")
      .single();

    if (error) setNotice(`모임 추가 실패: ${error.message}`);
    else {
      await logActivity(
        "모임 생성",
        "meeting",
        data.id,
        `${newMeetingDate} · ${newMeetingTitle.trim()} 모임 생성`
      );
      setNewMeetingTitle("");
      setSelectedMonth(newMeetingDate.slice(0, 7));
      setSelectedMeetingId(data.id);
      await loadAll();
    }
    setSaving(false);
  }

  async function copyMeeting(meeting: Meeting) {
    if (saving) return;

    const copiedDate = window.prompt(
      `${meeting.title} 모임을 복사할 날짜를 입력해주세요. (YYYY-MM-DD)`,
      today
    );

    if (!copiedDate) return;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(copiedDate)) {
      setNotice("날짜는 YYYY-MM-DD 형식으로 입력해주세요.");
      return;
    }

    setSaving(true);
    setNotice("");

    const { data: created, error: meetingError } = await supabase
      .from("meetings")
      .insert({
        date: copiedDate,
        title: meeting.title,
        cost: null,
      })
      .select("id")
      .single();

    if (meetingError || !created) {
      setNotice(`모임 복사 실패: ${meetingError?.message ?? "생성 결과를 확인할 수 없습니다."}`);
      setSaving(false);
      return;
    }

    if (meeting.attendeeIds.length > 0) {
      const { error: attendanceError } = await supabase.from("attendance").insert(
        meeting.attendeeIds.map((memberId) => ({
          meeting_id: created.id,
          member_id: memberId,
        }))
      );

      if (attendanceError) {
        setNotice(
          `모임은 복사됐지만 참석자 복사에 실패했습니다: ${attendanceError.message}`
        );
        setSaving(false);
        await loadAll();
        return;
      }
    }

    setSelectedMonth(copiedDate.slice(0, 7));
    setSelectedMeetingId(created.id);
    setDetailMeetingId("");
    setAttendeeSearch("");
    await logActivity(
      "모임 복사",
      "meeting",
      created.id,
      `${meeting.date} · ${meeting.title} 모임을 ${copiedDate}로 복사`
    );
    setNotice(
      `"${meeting.title}" 모임을 ${copiedDate}로 복사했습니다. 비용과 게스트는 새로 입력해주세요.`
    );
    await loadAll();
    setSaving(false);
  }

  function beginMeetingEdit(meeting: Meeting) {
    setEditingMeetingId(meeting.id);
    setEditingMeetingTitle(meeting.title);
    setEditingMeetingDate(meeting.date);
  }

  async function saveMeetingInfo(meeting: Meeting) {
    const title = editingMeetingTitle.trim();
    const date = editingMeetingDate;

    if (!title || !date) {
      setNotice("모임명과 날짜를 모두 입력해주세요.");
      return;
    }

    setSaving(true);
    setNotice("");

    const { error } = await supabase
      .from("meetings")
      .update({ title, date })
      .eq("id", meeting.id);

    if (error) {
      setNotice(`모임 수정 실패: ${error.message}`);
    } else {
      await logActivity(
        "모임 수정",
        "meeting",
        meeting.id,
        `${meeting.date} · ${meeting.title} → ${date} · ${title}`
      );
      setEditingMeetingId("");
      setEditingMeetingTitle("");
      setEditingMeetingDate("");
      setSelectedMonth(date.slice(0, 7));
      setSelectedMeetingId(meeting.id);
      setDetailMeetingId("");
      await loadAll();
    }

    setSaving(false);
  }

  async function deleteMeeting(meeting: Meeting) {
    const ok = window.confirm(
      `"${meeting.title}" (${meeting.date}) 모임을 삭제할까요?\n\n참석자, 게스트, 비용배분 데이터도 함께 삭제됩니다.`
    );
    if (!ok) return;

    setSaving(true);
    setNotice("");

    const { error } = await supabase
      .from("meetings")
      .delete()
      .eq("id", meeting.id);

    if (error) {
      setNotice(`모임 삭제 실패: ${error.message}`);
    } else {
      await logActivity(
        "모임 삭제",
        "meeting",
        meeting.id,
        `${meeting.date} · ${meeting.title} 모임 삭제`
      );
      if (selectedMeetingId === meeting.id) setSelectedMeetingId("");
      if (detailMeetingId === meeting.id) setDetailMeetingId("");
      setEditingMeetingId("");
      await loadAll();
    }

    setSaving(false);
  }

  // 참석 체크: 누르는 즉시 화면에 반영하고 저장은 뒤에서 한다 (실패하면 되돌린다)
  //   예전에는 저장 → PET 알림 → 전체 다시 불러오기를 모두 기다리고, 그동안 다른 체크도 막혀서 느렸다.
  const attendancePending = useRef<Set<string>>(new Set());

  // 👑 벙주 지정 (벙포 지급 대상)
  async function setMeetingHost(memberId: string | null) {
    if (!selectedMeeting) return;
    const meetingId = selectedMeeting.id;
    const before = selectedMeeting.host_member ?? null;
    setMeetings((current) => current.map((meeting) => (meeting.id === meetingId ? { ...meeting, host_member: memberId } : meeting)));
    const { error } = await supabase.from("meetings").update({ host_member: memberId }).eq("id", meetingId);
    if (error) {
      setMeetings((current) => current.map((meeting) => (meeting.id === meetingId ? { ...meeting, host_member: before } : meeting)));
      setNotice(`벙주 저장 실패: ${error.message}`);
    }
  }

  // 💻 온라인 참석 표시 (벙포 50%)
  async function toggleOnline(memberId: string) {
    if (!selectedMeeting) return;
    const meetingId = selectedMeeting.id;
    const on = !(selectedMeeting.onlineIds ?? []).includes(memberId);
    const apply = (value: boolean) =>
      setMeetings((current) =>
        current.map((meeting) =>
          meeting.id !== meetingId
            ? meeting
            : {
                ...meeting,
                onlineIds: value
                  ? [...(meeting.onlineIds ?? []).filter((id) => id !== memberId), memberId]
                  : (meeting.onlineIds ?? []).filter((id) => id !== memberId),
              },
        ),
      );
    apply(on);
    const { error } = await supabase.from("attendance").update({ online: on }).eq("meeting_id", meetingId).eq("member_id", memberId);
    if (error) {
      apply(!on);
      setNotice(`온라인 표시 실패: ${error.message}`);
    }
  }

  async function toggleAttendance(memberId: string) {
    if (!selectedMeeting) return;
    const meetingId = selectedMeeting.id;
    const key = `${meetingId}:${memberId}`;
    if (attendancePending.current.has(key)) return; // 같은 칸을 연달아 누른 경우만 무시
    attendancePending.current.add(key);
    setNotice("");

    const checked = selectedMeeting.attendeeIds.includes(memberId);
    const setChecked = (on: boolean) =>
      setMeetings((current) =>
        current.map((meeting) =>
          meeting.id !== meetingId
            ? meeting
            : {
                ...meeting,
                attendeeIds: on
                  ? meeting.attendeeIds.includes(memberId)
                    ? meeting.attendeeIds
                    : [...meeting.attendeeIds, memberId]
                  : meeting.attendeeIds.filter((id) => id !== memberId),
              },
        ),
      );
    setChecked(!checked);

    let failed: string | null = null;
    if (checked) {
      // 참석 해제: 그 사람의 정산 조정·선결제도 함께 지운다 (기존과 같음)
      const [, , removed] = await Promise.all([
        supabase.from("settlement_adjustments").delete().eq("meeting_id", meetingId).eq("member_id", memberId),
        supabase.from("meeting_prepayments").delete().eq("meeting_id", meetingId).eq("member_id", memberId),
        supabase.from("attendance").delete().eq("meeting_id", meetingId).eq("member_id", memberId),
      ]);
      if (removed.error) failed = removed.error.message;
      else {
        setAdjustments((current) => current.filter((item) => !(item.meeting_id === meetingId && item.member_id === memberId)));
        setPrepayments((current) => current.filter((item) => !(item.meeting_id === meetingId && item.member_id === memberId)));
      }
    } else {
      const { data: createdAttendance, error } = await supabase
        .from("attendance")
        .insert({ meeting_id: meetingId, member_id: memberId })
        .select("member_id, created_at")
        .single();
      if (error || !createdAttendance) {
        failed = error?.message ?? "참석 저장 결과를 확인할 수 없습니다.";
      } else {
        // PET 연동은 기다리지 않는다 (실패해도 참석 저장은 그대로)
        void notifyPetAttendances(meetingId, [createdAttendance]);
      }
    }

    attendancePending.current.delete(key);
    if (failed) {
      setChecked(checked); // 되돌리기
      setNotice(`참석 변경 실패: ${failed}`);
    }
  }

  async function saveCost(meetingId: string) {
    const value = Number(editingCost);
    if (!Number.isFinite(value) || value < 0) {
      setNotice("비용은 0 이상의 숫자로 입력해주세요.");
      return;
    }

    const meeting = meetings.find((item) => item.id === meetingId);
    if (meeting) {
      const memberFixed = meeting.attendeeIds.reduce((sum, memberId) => {
        const item = adjustmentByKey[`${meeting.id}:${memberId}`];
        return sum + (item ? Number(item.amount) : 0);
      }, 0);
      const guestFixed = meeting.guests.reduce(
        (sum, guest) =>
          sum + (guest.fixed_amount == null ? 0 : Number(guest.fixed_amount)),
        0
      );

      if (value < memberFixed + guestFixed) {
        setNotice(
          `총 비용은 현재 특정값 합계 ${won(memberFixed + guestFixed)}보다 작을 수 없습니다.`
        );
        return;
      }
    }

    setSaving(true);
    const { error } = await supabase
      .from("meetings")
      .update({ cost: Math.round(value) })
      .eq("id", meetingId);

    if (error) setNotice(`비용 저장 실패: ${error.message}`);
    else {
      const meeting = meetings.find((item) => item.id === meetingId);
      await logActivity(
        "비용 수정",
        "meeting",
        meetingId,
        `${meeting?.title ?? "모임"} 총 비용을 ${won(Math.round(value))}로 저장`
      );
      setEditingCostId("");
      setEditingCost("");
      await loadAll();
    }
    setSaving(false);
  }

  async function addGuest() {
    if (!selectedMeeting || !newGuestName.trim() || saving) return;
    setSaving(true);
    setNotice("");

    const { error } = await supabase.from("meeting_guests").insert({
      meeting_id: selectedMeeting.id,
      name: newGuestName.trim(),
      fixed_amount: null,
    });

    if (error) setNotice(`게스트 추가 실패: ${error.message}`);
    else {
      setNewGuestName("");
      await loadAll();
    }
    setSaving(false);
  }

  async function deleteGuest(guest: MeetingGuest) {
    if (!window.confirm(`${guest.name} 게스트를 삭제할까요?`)) return;
    setSaving(true);

    const { error } = await supabase
      .from("meeting_guests")
      .delete()
      .eq("id", guest.id);

    if (error) setNotice(`게스트 삭제 실패: ${error.message}`);
    else await loadAll();
    setSaving(false);
  }

  async function saveMemberFixed(memberId: string) {
    if (!selectedMeeting || selectedMeeting.cost == null) {
      setNotice("먼저 모임 비용을 입력해주세요.");
      return;
    }

    const key = `${selectedMeeting.id}:${memberId}`;
    const existing = adjustmentByKey[key];
    const raw =
      memberFixedDrafts[memberId] ??
      (existing ? String(existing.amount) : "");

    const amount = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(amount) || amount < 0) {
      setNotice("특정금액을 올바르게 입력해주세요.");
      return;
    }

    const otherMemberFixed = selectedMeeting.attendeeIds.reduce((sum, id) => {
      if (id === memberId) return sum;
      const item = adjustmentByKey[`${selectedMeeting.id}:${id}`];
      return sum + (item ? Number(item.amount) : 0);
    }, 0);

    const guestFixed = selectedMeeting.guests.reduce(
      (sum, guest) =>
        sum + (guest.fixed_amount == null ? 0 : Number(guest.fixed_amount)),
      0
    );

    if (otherMemberFixed + guestFixed + amount > Number(selectedMeeting.cost)) {
      setNotice("특정금액 합계가 모임 총비용을 초과할 수 없습니다.");
      return;
    }

    setSaving(true);
    const { error } = await supabase
      .from("settlement_adjustments")
      .upsert(
        {
          meeting_id: selectedMeeting.id,
          member_id: memberId,
          amount: Math.round(amount),
        },
        { onConflict: "meeting_id,member_id" }
      );

    if (error) setNotice(`특정금액 저장 실패: ${error.message}`);
    else {
      setMemberFixedDrafts((current) => {
        const next = { ...current };
        delete next[memberId];
        return next;
      });
      await loadAll();
    }
    setSaving(false);
  }

  async function clearMemberFixed(memberId: string) {
    if (!selectedMeeting) return;
    setSaving(true);

    const { error } = await supabase
      .from("settlement_adjustments")
      .delete()
      .eq("meeting_id", selectedMeeting.id)
      .eq("member_id", memberId);

    if (error) setNotice(`특정금액 해제 실패: ${error.message}`);
    else await loadAll();
    setSaving(false);
  }

  async function saveGuestFixed(guest: MeetingGuest) {
    if (!selectedMeeting || selectedMeeting.cost == null) {
      setNotice("먼저 모임 비용을 입력해주세요.");
      return;
    }

    const raw =
      guestFixedDrafts[guest.id] ??
      (guest.fixed_amount == null ? "" : String(guest.fixed_amount));

    const amount = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(amount) || amount < 0) {
      setNotice("게스트 특정금액을 올바르게 입력해주세요.");
      return;
    }

    const memberFixed = selectedMeeting.attendeeIds.reduce((sum, id) => {
      const item = adjustmentByKey[`${selectedMeeting.id}:${id}`];
      return sum + (item ? Number(item.amount) : 0);
    }, 0);

    const otherGuestFixed = selectedMeeting.guests.reduce((sum, item) => {
      if (item.id === guest.id) return sum;
      return sum + (item.fixed_amount == null ? 0 : Number(item.fixed_amount));
    }, 0);

    if (memberFixed + otherGuestFixed + amount > Number(selectedMeeting.cost)) {
      setNotice("특정금액 합계가 모임 총비용을 초과할 수 없습니다.");
      return;
    }

    setSaving(true);
    const { error } = await supabase
      .from("meeting_guests")
      .update({ fixed_amount: Math.round(amount) })
      .eq("id", guest.id);

    if (error) setNotice(`게스트 금액 저장 실패: ${error.message}`);
    else {
      setGuestFixedDrafts((current) => {
        const next = { ...current };
        delete next[guest.id];
        return next;
      });
      await loadAll();
    }
    setSaving(false);
  }

  async function clearGuestFixed(guestId: string) {
    setSaving(true);
    const { error } = await supabase
      .from("meeting_guests")
      .update({ fixed_amount: null })
      .eq("id", guestId);

    if (error) setNotice(`게스트 금액 해제 실패: ${error.message}`);
    else await loadAll();
    setSaving(false);
  }

  async function saveMemberAllocation(memberId: string) {
    if (!selectedMeeting || selectedMeeting.cost == null) {
      setNotice("먼저 모임 비용을 입력해주세요.");
      return;
    }

    const adjustmentKey = `${selectedMeeting.id}:${memberId}`;
    const existingAdjustment = adjustmentByKey[adjustmentKey];
    const fixedRaw =
      memberFixedDrafts[memberId] ??
      (existingAdjustment ? String(existingAdjustment.amount) : "");

    const existingPrepayment = selectedPrepaymentByMember[memberId];
    const prepaymentRaw =
      prepaymentDrafts[memberId] ??
      (existingPrepayment ? String(existingPrepayment.amount) : "0");

    const hasFixed = fixedRaw.trim() !== "";
    const fixedAmount = hasFixed ? Number(fixedRaw) : 0;
    const prepaymentAmount = Number(prepaymentRaw);

    if (hasFixed && (!Number.isFinite(fixedAmount) || fixedAmount < 0)) {
      setNotice("특정값은 0 이상의 숫자로 입력해주세요.");
      return;
    }

    if (!Number.isFinite(prepaymentAmount) || prepaymentAmount < 0) {
      setNotice("선입금은 0 이상의 숫자로 입력해주세요.");
      return;
    }

    if (hasFixed) {
      const otherMemberFixed = selectedMeeting.attendeeIds.reduce((sum, id) => {
        if (id === memberId) return sum;
        const item = adjustmentByKey[`${selectedMeeting.id}:${id}`];
        return sum + (item ? Number(item.amount) : 0);
      }, 0);

      const guestFixed = selectedMeeting.guests.reduce(
        (sum, guest) =>
          sum + (guest.fixed_amount == null ? 0 : Number(guest.fixed_amount)),
        0
      );

      if (
        otherMemberFixed + guestFixed + fixedAmount >
        Number(selectedMeeting.cost)
      ) {
        setNotice("특정값 합계가 모임 총비용을 초과할 수 없습니다.");
        return;
      }
    }

    setSaving(true);
    setNotice("");

    const tasks = [];

    if (hasFixed) {
      tasks.push(
        supabase
          .from("settlement_adjustments")
          .upsert(
            {
              meeting_id: selectedMeeting.id,
              member_id: memberId,
              amount: Math.round(fixedAmount),
            },
            { onConflict: "meeting_id,member_id" }
          )
      );
    } else if (existingAdjustment) {
      tasks.push(
        supabase
          .from("settlement_adjustments")
          .delete()
          .eq("meeting_id", selectedMeeting.id)
          .eq("member_id", memberId)
      );
    }

    if (prepaymentAmount > 0) {
      tasks.push(
        supabase
          .from("meeting_prepayments")
          .upsert(
            {
              meeting_id: selectedMeeting.id,
              member_id: memberId,
              amount: Math.round(prepaymentAmount),
            },
            { onConflict: "meeting_id,member_id" }
          )
      );
    } else if (existingPrepayment) {
      tasks.push(
        supabase
          .from("meeting_prepayments")
          .delete()
          .eq("meeting_id", selectedMeeting.id)
          .eq("member_id", memberId)
      );
    }

    const results = await Promise.all(tasks);
    const error = results.find((result) => result.error)?.error;

    if (error) {
      setNotice(`비용 배분 저장 실패: ${error.message}`);
    } else {
      setMemberFixedDrafts((current) => {
        const next = { ...current };
        delete next[memberId];
        return next;
      });
      setPrepaymentDrafts((current) => {
        const next = { ...current };
        delete next[memberId];
        return next;
      });
      await loadAll();
    }

    setSaving(false);
  }


  if (authLoading && !currentUserId) {
    return (
      <main className="authPage">
        <div className="authCard">
          <div className="authLogo">JJ</div>
          <h1>강서구 찐친만들기</h1>
          <p>로그인 정보를 확인하고 있습니다.</p>
          <div className="authLoadingBar" />
        </div>
      </main>
    );
  }

  if (!currentUserId) {
    return (
      <main className="authPage">
        <section className="authCard authCardWide">
          <div className="authBrandRow">
            <div className="authLogo">JJ</div>
            <div>
              <div className="kicker">MEETING MANAGER</div>
              <h1>강서구 찐친만들기</h1>
            </div>
          </div>

          {gameInvite && (
            <div className="omokInviteNotice">
              <strong>
                {gameInvite.kind === "catch"
                  ? "🎨 캐치마인드 초대가 도착했어요!"
                  : gameInvite.kind === "alkkagi"
                    ? "🥏 알까기 대국신청이 도착했어요!"
                    : "🏁 오목 대국신청이 도착했어요!"}
              </strong>
              <span>로그인하면 바로 대국 화면으로 이동합니다.</span>
              <span>
                아직 계정이 없다면 <b>최초 가입</b>에서 카톡방 닉네임으로 가입해 주세요.
              </span>
            </div>
          )}

          <div className="authModeTabs">
            <button
              className={authMode === "login" ? "active" : ""}
              onClick={() => {
                setAuthMode("login");
                setLoginNotice("");
              }}
            >
              로그인
            </button>
            <button
              className={authMode === "signup" ? "active" : ""}
              onClick={() => {
                setAuthMode("signup");
                setLoginNotice("");
              }}
            >
              최초 가입
            </button>
          </div>

          {authMode === "login" ? (
            <div className="authForm">
              <label>
                <span>닉네임</span>
                <input
                  value={loginNickname}
                  onChange={(event) => setLoginNickname(event.target.value)}
                  placeholder="가입한 닉네임"
                  autoComplete="username"
                />
              </label>
              <label>
                <span>비밀번호</span>
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(event) => setLoginPassword(event.target.value)}
                  placeholder="비밀번호"
                  autoComplete="current-password"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void login();
                  }}
                />
              </label>
              <button className="authPrimaryButton" onClick={() => void login()}>
                로그인
              </button>
            </div>
          ) : (
            <div className="authForm">
              <div className="signupGuide">
                처음 방문한 회원은 본인의 닉네임과 비밀번호를 직접 정해 가입합니다.
              </div>
              <label>
                <span>사용할 닉네임</span>
                <input
                  value={signupNickname}
                  onChange={(event) => setSignupNickname(event.target.value)}
                  placeholder="모임에서 사용할 닉네임"
                  autoComplete="username"
                />
              </label>
              <label>
                <span>생일</span>
                <input
                  type="date"
                  value={signupBirthday}
                  max={today}
                  onChange={(event) => setSignupBirthday(event.target.value)}
                  autoComplete="bday"
                />
              </label>
              <label>
                <span>비밀번호</span>
                <input
                  type="password"
                  value={signupPassword}
                  onChange={(event) => setSignupPassword(event.target.value)}
                  placeholder="6자 이상"
                  autoComplete="new-password"
                />
              </label>
              <label>
                <span>비밀번호 확인</span>
                <input
                  type="password"
                  value={signupPasswordConfirm}
                  onChange={(event) => setSignupPasswordConfirm(event.target.value)}
                  placeholder="비밀번호 다시 입력"
                  autoComplete="new-password"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void signup();
                  }}
                />
              </label>
              <button className="authPrimaryButton" onClick={() => void signup()}>
                가입하고 시작하기
              </button>
            </div>
          )}

          {loginNotice && <div className="authNotice">{loginNotice}</div>}

          {ownerExists === false && (
            <>
              <button
                className="creatorSetupToggle"
                onClick={() => setShowCreatorSetup((value) => !value)}
              >
                {showCreatorSetup ? "초기 운영자 설정 닫기" : "초기 운영자 설정"}
              </button>

              {showCreatorSetup && (
                <div className="creatorSetupBox">
                  <strong>최초 제작자(owner) 지정</strong>
                  <p>
                    제작자로 사용할 계정을 먼저 '최초 가입'한 뒤 설정키와 닉네임을 입력합니다.
                    제작자 지정이 완료되면 이 메뉴는 로그인 화면에서 자동으로 사라집니다.
                  </p>
                  <input
                    type="password"
                    placeholder="CREATOR_SETUP_KEY"
                    value={creatorSetupKey}
                    onChange={(event) => setCreatorSetupKey(event.target.value)}
                    autoComplete="off"
                  />
                  <input
                    placeholder="이미 가입한 제작자 닉네임"
                    value={creatorNickname}
                    onChange={(event) => setCreatorNickname(event.target.value)}
                  />
                  <button className="smallButton" onClick={() => void setupCreator()}>
                    제작자로 지정
                  </button>
                </div>
              )}
            </>
          )}

          <small className="authFooter">Made by. 퐁당</small>
        </section>
      </main>
    );
  }

  return (
    <main className="pageShell">
      <header className="topHeader">
        <div>
          <div className="kicker">MEETING MANAGER</div>
          <h1>강서구 찐친만들기 현황관리</h1>
        </div>

        <div className="headerControls">
          <label className="monthControl">
            <span>조회 월</span>
            <input
              type="month"
              value={selectedMonth}
              onChange={(event) => setSelectedMonth(event.target.value)}
            />
          </label>

          <div className="loginUserBox">
            <div>
              <strong>{currentNickname}</strong>
              <span className={`roleBadge ${currentRole ?? "user"}`}>
                {currentRole === "owner"
                  ? "제작자"
                  : currentRole === "admin"
                    ? "관리자"
                    : "회원"}
              </span>
            </div>
            <button
              className="logoutButton installButton"
              onClick={() => void installApp()}
            >
              앱 설치
            </button>
            <button
              className="logoutButton"
              onClick={() => {
                setShowAccountPanel(true);
                void loadPetLinkStatus();
              }}
            >
              내 계정
            </button>
            <button className="logoutButton" onClick={() => void logout()}>
              로그아웃
            </button>
          </div>
        </div>
      </header>

      <nav className="mainTabs desktopMainTabs">
        {[
          ["dashboard", "대시보드"],
          ["meetings", "모임 관리"],
          ["members", "회원 현황"],
          ["monthly", "월별 참석 현황"],
          ["history", "변경 이력"],
          ["help", "사용방법"],
        ].map(([value, label]) => (
          <button
            key={value}
            className={mainTab === value ? "tabButton active" : "tabButton"}
            data-tab={value}
            onClick={() => setMainTab(value as MainTab)}
          >
            {label}
          </button>
        ))}
      </nav>

      <nav className="mobileBottomNav" aria-label="모바일 주요 메뉴">
        {[
          ["dashboard", "⌂", "홈"],
          ["meetings", "●", "모임"],
          ["members", "♟", "회원"],
        ].map(([value, icon, label]) => (
          <button
            key={value}
            className={mainTab === value ? "active" : ""}
            onClick={() => {
              setMainTab(value as MainTab);
              setShowMobileMore(false);
            }}
          >
            <span>{icon}</span>
            <strong>{label}</strong>
          </button>
        ))}
        <button
          className={["monthly", "history", "help"].includes(mainTab) || showMobileMore ? "active" : ""}
          onClick={() => setShowMobileMore((current) => !current)}
        >
          <span>•••</span>
          <strong>더보기</strong>
        </button>
      </nav>

      {showMobileMore && (
        <div className="mobileMoreBackdrop" onClick={() => setShowMobileMore(false)}>
          <section className="mobileMoreSheet" onClick={(event) => event.stopPropagation()}>
            <div className="mobileMoreHandle" />
            <div className="mobileMoreHead">
              <strong>더보기</strong>
              <button onClick={() => setShowMobileMore(false)}>×</button>
            </div>
            {[
              ["monthly", "월별 참석 현황", "월별 참석·부담금 확인"],
              ["history", "변경 이력", "최근 운영 변경 기록"],
              ["help", "사용방법", "기능과 권한 안내"],
            ].map(([value, label, description]) => (
              <button
                className="mobileMoreItem"
                key={value}
                onClick={() => {
                  setMainTab(value as MainTab);
                  setShowMobileMore(false);
                }}
              >
                <div><strong>{label}</strong><span>{description}</span></div>
                <em>›</em>
              </button>
            ))}
            <button
              className="mobileMoreItem"
              onClick={() => {
                setShowAccountPanel(true);
                setShowMobileMore(false);
              }}
            >
              <div><strong>내 계정</strong><span>비밀번호 및 계정 관리</span></div>
              <em>›</em>
            </button>
          </section>
        </div>
      )}

      {notice && (
        <div className="notice appToast" role="status">
          <span>{notice}</span>
          <button onClick={() => setNotice("")} aria-label="알림 닫기">×</button>
        </div>
      )}

      <section className="myStatusStrip">
        <button
          className="myIdentity myIdentityButton"
          onClick={() => setShowMyActivity(true)}
        >
          <span>내 현황 · 상세보기</span>
          <strong>{currentNickname}</strong>
          <small>{selectedMonth}</small>
        </button>
        <div className="myStatusItem">
          <span>참석</span>
          <strong>{myMonthSummary.attendance}회</strong>
        </div>
        <div className="myStatusItem">
          <span>벙비 합계</span>
          <strong>{mainTab === "dashboard" && !showDashboardCosts ? "••••••원" : won(myMonthSummary.burden)}</strong>
        </div>
      </section>

      {mainTab === "dashboard" && (
        <>
          <section className="meetingDashboardHero">
            <div className="meetingDashboardTitle">
              <div>
                <span className="dashboardEyebrow">{selectedMonth}</span>
                <h2>이번 달 모임 한눈에 보기</h2>
                <p>핵심 수치와 인기 모임·참석 랭킹을 한 화면에서 확인합니다.</p>
              </div>
              <div className="dashboardTitleActions" style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button
                  className="dashboardManageButton"
                  type="button"
                  aria-pressed={showDashboardCosts}
                  onClick={() => setShowDashboardCosts((visible) => !visible)}
                >
                  {showDashboardCosts ? "🙈 금액 숨기기" : "👁 금액 보기"}
                </button>
                <button
                  className="dashboardManageButton"
                  onClick={() => setMainTab("meetings")}
                >
                  모임 관리 열기
                </button>
              </div>
            </div>

            <div className="meetingMetricGrid">
              <button className="meetingMetricCard" onClick={() => setMainTab("meetings")}>
                <span>모임</span>
                <strong>{monthMeetings.length}<em>회</em></strong>
                <small>이번 달 등록 모임</small>
              </button>

              <div className="meetingMetricCard">
                <span>총 참석</span>
                <strong>{monthAttendanceTotal}<em>명</em></strong>
                <small>평균 {averageMeetingAttendance.toFixed(1)}명 / 모임</small>
              </div>

              <div className="meetingMetricCard">
                <span>참여 회원</span>
                <strong>{uniqueMonthParticipants}<em>명</em></strong>
                <small>중복 제외 회원 기준</small>
              </div>

              <div className="meetingMetricCard">
                <span>총 벙비</span>
                <strong>{showDashboardCosts ? won(monthTotalCost) : "••••••원"}</strong>
                <small>
                  {showDashboardCosts
                    ? `평균 ${won(averageMeetingCost)} / 비용 입력 모임`
                    : "금액 보기를 눌러 확인"}
                </small>
              </div>
            </div>
          </section>

          <section className="dashboardRankingGrid">
            <div className="panel dashboardRankingPanel popularMeetingPanel">
              <div className="panelHead compactHead">
                <div>
                  <h2>🔥 인기 모임 TOP 5</h2>
                  <p>참여 인원이 많았던 모임</p>
                </div>
                <span className="dashboardPanelBadge">{popularMeetings.length}건</span>
              </div>

              <div className="popularMeetingList">
                {popularMeetings.map(({ meeting, totalAttendees, attendanceRate, displayRank }) => (
                  <button
                    className={`popularMeetingCard rank${displayRank}`}
                    key={meeting.id}
                    onClick={() => {
                      setSelectedMeetingId(meeting.id);
                      setMainTab("meetings");
                    }}
                  >
                    <span className="dashboardRankNumber">{displayRank === 1 ? "🥇" : displayRank === 2 ? "🥈" : displayRank === 3 ? "🥉" : displayRank}</span>
                    <div className="popularMeetingMain">
                      <div className="popularMeetingTitleLine">
                        <strong>{meeting.title}</strong>
                        <span>{meeting.date.slice(5).replace("-", ".")}</span>
                      </div>
                      <div className="popularMeetingRateLine">
                        <div className="popularMeetingRateTrack" aria-hidden="true">
                          <span style={{ width: `${attendanceRate}%` }} />
                        </div>
                        <strong>{attendanceRate}%</strong>
                      </div>
                    </div>
                    <div className="popularMeetingPeople">
                      <strong>{totalAttendees}</strong>
                      <span>명 참석</span>
                    </div>
                  </button>
                ))}

                {popularMeetings.length === 0 && (
                  <div className="empty dashboardEmpty">이번 달 모임이 없습니다.</div>
                )}
              </div>
            </div>

            <div className="panel dashboardRankingPanel attendanceTopPanel">
              <div className="panelHead compactHead">
                <div>
                  <h2>🏆 이달의 벙신 TOP 5</h2>
                  <p>이번 달 모임에 가장 많이 참여한 회원</p>
                </div>
                <button
                  className="linkButton"
                  onClick={() => setMainTab("monthly")}
                >
                  전체 현황
                </button>
              </div>

              <div className="dashboardAttendanceList">
                {topAttendance.map((item) => (
                  <button
                    className={`dashboardAttendanceCard rank${item.displayRank}`}
                    key={item.member.id}
                    onClick={() => setMemberDetailId(item.member.id)}
                  >
                    <span className="dashboardRankNumber">{item.displayRank === 1 ? "🥇" : item.displayRank === 2 ? "🥈" : item.displayRank === 3 ? "🥉" : item.displayRank}</span>
                    <div>
                      <strong>{item.member.name}</strong>
                      <small>
                        {monthMeetings.length > 0
                          ? `참석률 ${Math.round((item.attendanceCount / monthMeetings.length) * 100)}%`
                          : "참석률 0%"}
                      </small>
                    </div>
                    <strong className="attendanceCountValue">{item.attendanceCount}회</strong>
                  </button>
                ))}

                {topAttendance.length === 0 && (
                  <div className="empty dashboardEmpty">이번 달 참석 기록이 없습니다.</div>
                )}
              </div>
            </div>

            <div className="panel dashboardRankingPanel birthdayPanel">
              <div className="panelHead compactHead">
                <div>
                  <h2>🎂 이달의 생일자</h2>
                  <p>{selectedMonth.slice(0, 4)}년 {Number(selectedMonth.slice(5, 7))}월 · 활동중 회원</p>
                </div>
                <span className="dashboardPanelBadge">{monthBirthdays.length}명</span>
              </div>

              <div className="birthdayMemberList">
                {monthBirthdays.map((member) => (
                  <button
                    className="birthdayMemberCard"
                    key={member.id}
                    onClick={() => setMemberDetailId(member.id)}
                  >
                    <span className="birthdayIcon">🎉</span>
                    <div>
                      <strong>{member.name}</strong>
                      <small>생일 축하해요!</small>
                    </div>
                    <strong className="birthdayDate">
                      {member.birthday?.slice(5).replace("-", ".")}
                    </strong>
                  </button>
                ))}

                {monthBirthdays.length === 0 && (
                  <div className="empty dashboardEmpty">이번 달 생일자가 없습니다.</div>
                )}
              </div>
            </div>
          </section>

          <section className="dashboardActionGrid">
            <button
              className={`managementNeedButton dashboardActionCard ${warningMembers.length > 0 ? "hasWarning" : ""}`}
              onClick={() => {
                setMemberFilter("warning");
                setMainTab("members");
              }}
            >
              <div>
                <span>관리 필요</span>
                <strong>{warningMembers.length}명</strong>
              </div>
              <p>
                {warningMembers.length > 0
                  ? "참석 경고 회원을 회원 현황에서 바로 확인합니다."
                  : "현재 경고 상태 회원이 없습니다."}
              </p>
              <em>회원 현황 · 경고 보기 →</em>
            </button>

            <div className="panel costProgressPanel dashboardActionCard">
              <div className="panelHead compactHead">
                <div>
                  <h2>비용 입력 현황</h2>
                  <p>모임 정산 준비 상태</p>
                </div>
                <strong className="costProgressCompact">
                  {completedCostMeetings}/{monthMeetings.length}
                </strong>
              </div>

              <div className="costProgressTrack" aria-hidden="true">
                <span
                  style={{
                    width:
                      monthMeetings.length > 0
                        ? `${(completedCostMeetings / monthMeetings.length) * 100}%`
                        : "0%",
                  }}
                />
              </div>

              {costMissingMeetings.length > 0 ? (
                <button
                  className="costMissingAction"
                  onClick={() => {
                    setSelectedMeetingId(costMissingMeetings[0].id);
                    setMainTab("meetings");
                  }}
                >
                  비용 미입력 {costMissingMeetings.length}건 확인
                </button>
              ) : (
                <span className="costCompleteText">모든 모임의 비용이 입력되었습니다.</span>
              )}
            </div>
          </section>

          <section className="dashboardInsightsGrid">
            <div className="panel dashboardInsightPanel"><div className="panelHead compactHead"><div><h2>📊 운영 통계</h2><p>{selectedMonth} 활동 흐름</p></div></div><div className="insightMetricGrid"><div><span>활동회원 참여율</span><strong>{operationsStats.participationRate}%</strong></div><div><span>비용 입력 완료율</span><strong>{operationsStats.settleRate}%</strong></div><div><span>신규회원</span><strong>{operationsStats.joined}명</strong></div><div><span>신규 첫참석</span><strong>{operationsStats.settled}명</strong></div></div></div>
            {isAdmin && <div className="panel dashboardInsightPanel adminWorkCenter"><div className="panelHead compactHead"><div><h2>🛠 관리자 작업센터</h2><p>지금 확인할 운영 항목</p></div></div><button onClick={() => {setMemberFilter("warning");setMainTab("members");}}><span>경고 회원</span><strong>{warningMembers.length}명</strong></button><button onClick={() => setMainTab("meetings")}><span>비용 미입력 벙</span><strong>{costMissingMeetings.length}건</strong></button><button onClick={() => setMainTab("history")}><span>최근 변경 이력</span><strong>{activityLogs.length}건</strong></button><div className="backupActionRow"><button className="smallButton" onClick={exportBackupJson}>JSON 백업</button><button className="smallButton ghost" onClick={() => backupRestoreInputRef.current?.click()} disabled={saving}>백업 복원</button><input ref={backupRestoreInputRef} type="file" accept="application/json,.json" hidden onChange={(e) => {const file=e.target.files?.[0]; if(file) void restoreBackupJson(file);}} /></div><small className="backupHint">복원은 운영 데이터만 병합하며 로그인·PET 계정은 건드리지 않습니다.</small></div>}
          </section>
        </>
      )}

      {mainTab === "meetings" && (
        <>
          <section className="meetingOpsSummary panel standalonePanel">
            <div className="meetingOpsSummaryTitle">
              <div>
                <span>{selectedMonth}</span>
                <strong>이번 달 운영 요약</strong>
              </div>
              <small>모임 관리 기준</small>
            </div>
            <div className="meetingOpsSummaryGrid">
              <div><span>모임</span><strong>{monthMeetings.length}회</strong></div>
              <div><span>총 참석</span><strong>{monthAttendanceTotal}명</strong></div>
              <div><span>참여 회원</span><strong>{uniqueMonthParticipants}명</strong></div>
              <div><span>총 벙비</span><strong>{won(monthTotalCost)}</strong></div>
            </div>
          </section>

          <section className="panel standalonePanel appCalendarPanel meetingCalendarPanel">
            <div className="calendarHeader">
              <div>
                <span className="memberControlEyebrow">CALENDAR</span>
                <h2>벙 달력</h2>
                <p>날짜별 예정·진행된 벙을 확인하고 바로 선택할 수 있습니다.</p>
              </div>
              <div className="calendarMonthNav">
                <button
                  type="button"
                  aria-label="이전 달"
                  onClick={() => setMeetingCalendarMonth((month) => shiftMonth(month, -1))}
                >
                  ‹
                </button>
                <strong>{meetingCalendarMonth.replace("-", "년 ")}월</strong>
                <button
                  type="button"
                  aria-label="다음 달"
                  onClick={() => setMeetingCalendarMonth((month) => shiftMonth(month, 1))}
                >
                  ›
                </button>
                {meetingCalendarMonth !== currentMonth && (
                  <button
                    type="button"
                    className="calendarTodayButton"
                    onClick={() => setMeetingCalendarMonth(currentMonth)}
                  >
                    이번 달
                  </button>
                )}
              </div>
            </div>

            <div className="calendarWeekdays" aria-hidden="true">
              {["일", "월", "화", "수", "목", "금", "토"].map((day) => (
                <span key={day}>{day}</span>
              ))}
            </div>

            <div className="calendarGrid">
              {meetingCalendarCells.map((cell) => {
                const dayMeetings = meetingsByDate.get(cell.date) ?? [];
                return (
                  <div
                    className={`calendarDay ${cell.inMonth ? "" : "outside"} ${cell.date === today ? "today" : ""} ${cell.date === selectedCalendarDate ? "selectedDate" : ""}`}
                    key={cell.date}
                    onClick={() => setSelectedCalendarDate(cell.date)}
                  >
                    <div className="calendarDayNumber">
                      <span>{cell.day}</span>
                      {dayMeetings.length > 0 && <em>{dayMeetings.length}</em>}
                    </div>
                    <div className="calendarEvents">
                      {dayMeetings.slice(0, 3).map((meeting) => (
                        <button
                          key={meeting.id}
                          type="button"
                          className={meeting.id === selectedMeetingId ? "calendarEvent selected" : "calendarEvent"}
                          title={`${meeting.date} ${meeting.title}`}
                          onClick={() => {
                            setSelectedMeetingId(meeting.id);
                            setMemberFixedDrafts({});
                            setGuestFixedDrafts({});
                          }}
                        >
                          {meeting.title}
                        </button>
                      ))}
                      {dayMeetings.length > 3 && (
                        <button
                          type="button"
                          className="calendarMoreEvents"
                          onClick={() => {
                            setSelectedMeetingId(dayMeetings[3].id);
                            setMemberFixedDrafts({});
                            setGuestFixedDrafts({});
                          }}
                        >
                          +{dayMeetings.length - 3}개 더
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mobileCalendarDayList">
              <div className="modalSectionHead"><strong>{selectedCalendarDate} 벙</strong><span>{selectedCalendarMeetings.length}건</span></div>
              {selectedCalendarMeetings.map(meeting => <button key={meeting.id} onClick={() => setDetailMeetingId(meeting.id)}><div><strong>{meeting.title}</strong><span>{meeting.attendeeIds.length + meeting.guests.length}명 참석</span></div><em>›</em></button>)}
              {selectedCalendarMeetings.length === 0 && <div className="empty">선택한 날짜에 등록된 벙이 없습니다.</div>}
            </div>
          </section>

          <section className="controlGrid">
            <div className="panel standalonePanel">
              <div className="panelHead compactHead">
                <div>
                  <h2>모임 추가</h2>
                  <p>비용은 추후 입력</p>
                </div>
              </div>
              <div className="inlineForm">
                <input
                  type="date"
                  value={newMeetingDate}
                  onChange={(event) => setNewMeetingDate(event.target.value)}
                />
                <input
                  placeholder="모임명"
                  value={newMeetingTitle}
                  onChange={(event) => setNewMeetingTitle(event.target.value)}
                />
                <button className="smallButton" onClick={() => void addMeeting()}>
                  추가
                </button>
              </div>
            </div>

            <div className="panel standalonePanel">
              <div className="panelHead compactHead">
                <div>
                  <h2>모임 선택</h2>
                  <p>{selectedMonth}</p>
                </div>
              </div>
              <select
                value={selectedMeetingId}
                onChange={(event) => {
                  setSelectedMeetingId(event.target.value);
                  setMemberFixedDrafts({});
                  setGuestFixedDrafts({});
                }}
              >
                <option value="">모임 선택</option>
                {monthMeetings.map((meeting) => (
                  <option key={meeting.id} value={meeting.id}>
                    {meeting.date} · {meeting.title}
                  </option>
                ))}
              </select>
            </div>
          </section>

          {selectedMeeting && (
            <section className="selectedStrip">
              <div>
                <strong>{selectedMeeting.title}</strong>
                <span>{selectedMeeting.date}</span>
              </div>
              <div className="stripStats">
                <span>회원 {selectedMeeting.attendeeIds.length}명</span>
                <span>게스트 {selectedMeeting.guests.length}명</span>
                <span>
                  {selectedMeeting.cost == null
                    ? "비용 미입력"
                    : won(Number(selectedMeeting.cost))}
                </span>
                <button
                  className="stripActionButton"
                  onClick={() => setDetailMeetingId(selectedMeeting.id)}
                >
                  상세
                </button>
                <button
                  className="stripActionButton"
                  onClick={() => beginMeetingEdit(selectedMeeting)}
                >
                  수정
                </button>
                <button
                  className="stripActionButton"
                  onClick={() => void copyMeeting(selectedMeeting)}
                  disabled={saving}
                >
                  모임 복사
                </button>
                <button
                  className="stripActionButton danger"
                  onClick={() => void deleteMeeting(selectedMeeting)}
                  disabled={saving}
                >
                  삭제
                </button>
              </div>
            </section>
          )}

          {selectedMeeting && (
            <section className="meetingFlowStepper" aria-label="모임 정산 진행 단계">
              <div className="meetingFlowStep complete">
                <span>1</span>
                <div><strong>참석자</strong><small>{selectedMeeting.attendeeIds.length + selectedMeeting.guests.length}명</small></div>
              </div>
              <i />
              <div className={`meetingFlowStep ${selectedMeeting.cost != null ? "complete" : "current"}`}>
                <span>2</span>
                <div><strong>비용 입력</strong><small>{selectedMeeting.cost == null ? "입력 필요" : won(Number(selectedMeeting.cost))}</small></div>
              </div>
              <i />
              <div className={`meetingFlowStep ${selectedMeeting.cost != null && selectedMeeting.attendeeIds.length + selectedMeeting.guests.length > 0 ? "current" : ""}`}>
                <span>3</span>
                <div><strong>정산 공유</strong><small>카카오톡 공유</small></div>
              </div>
            </section>
          )}

          {selectedMeeting && editingMeetingId === selectedMeeting.id && (
            <section className="panel meetingEditPanel">
              <div className="panelHead compactHead">
                <div>
                  <h2>모임 정보 수정</h2>
                  <p>모임명과 날짜를 바로 수정할 수 있습니다.</p>
                </div>
              </div>
              <div className="inlineForm meetingInfoEditForm">
                <input
                  type="date"
                  value={editingMeetingDate}
                  onChange={(event) => setEditingMeetingDate(event.target.value)}
                />
                <input
                  value={editingMeetingTitle}
                  onChange={(event) => setEditingMeetingTitle(event.target.value)}
                  placeholder="모임명"
                />
                <button
                  className="smallButton"
                  onClick={() => void saveMeetingInfo(selectedMeeting)}
                  disabled={saving}
                >
                  수정 저장
                </button>
                <button
                  className="smallButton ghost"
                  onClick={() => {
                    setEditingMeetingId("");
                    setEditingMeetingTitle("");
                    setEditingMeetingDate("");
                  }}
                >
                  취소
                </button>
              </div>
            </section>
          )}

          <section className="meetingWorkspace">
            <div className="panel standalonePanel">
              <div className="panelHead compactHead">
                <div>
                  <h2>참석자 · 게스트</h2>
                  <p>게스트도 기본 1/N에 포함</p>
                </div>
              </div>

              {selectedMeeting ? (
                <>
                  <div className="attendeeBulkBar">
                    <button
                      className="tinyButton ghost"
                      onClick={() => void setAttendanceMembers(activeMembers.map((member) => member.id))}
                      disabled={saving}
                    >
                      전체 선택
                    </button>
                    <button
                      className="tinyButton ghost"
                      onClick={() => void setAttendanceMembers([])}
                      disabled={saving}
                    >
                      전체 해제
                    </button>
                    <button
                      className="tinyButton ghost"
                      onClick={() => void loadPreviousMeetingAttendees()}
                      disabled={saving}
                    >
                      이전 모임 참석자 불러오기
                    </button>
                  </div>

                  <div className="attendeeSearchBar attendeeSearchSortBar">
                    <input
                      type="search"
                      placeholder="참석자 닉네임 빠른 검색 (초성 가능)"
                      value={attendeeSearch}
                      onChange={(event) => setAttendeeSearch(event.target.value)}
                    />
                    <label className="meetingSortControl">
                      <span>참석자 정렬</span>
                      <select
                        value={attendeeSort}
                        onChange={(event) => setAttendeeSort(event.target.value as AttendeeSort)}
                        aria-label="참석자 정렬"
                      >
                        <option value="selected_first">선택된 회원 먼저</option>
                        <option value="nickname_asc">닉네임 가나다순</option>
                        <option value="nickname_desc">닉네임 역순</option>
                        <option value="join_desc">입장일 최신순</option>
                        <option value="join_asc">입장일 오래된순</option>
                        <option value="last_desc">최근 참석일 최신순</option>
                        <option value="last_asc">최근 참석일 오래된순</option>
                        <option value="count_desc">참석 많은순</option>
                      </select>
                    </label>
                    <span className="attendeeCount">
                      선택 {selectedMeeting.attendeeIds.length}명 / 전체 {activeMembers.length}명
                    </span>
                  </div>

                  {(selectedMeeting.attendeeIds.length > 0 || selectedMeeting.host_member) && (
                    <div className="hostPanel">
                      <div className="hostPanelHead">
                        <strong>👑 벙주 · 💻 온라인</strong>
                        <small>이름을 누르면 벙주, 💻 를 켜면 온라인 참석 (벙포 계산용)</small>
                      </div>
                      {selectedMeeting.host_member && !selectedMeeting.attendeeIds.includes(selectedMeeting.host_member) && (
                        <p className="hostPanelWarn">
                          👑 벙주 {members.find((item) => item.id === selectedMeeting.host_member)?.name ?? "?"}님이 아직 참석 체크되지 않았어요.
                        </p>
                      )}
                      <div className="hostPanelList">
                        {selectedMeeting.attendeeIds.map((memberId) => {
                          const member = members.find((item) => item.id === memberId);
                          if (!member) return null;
                          const isHost = selectedMeeting.host_member === memberId;
                          const online = (selectedMeeting.onlineIds ?? []).includes(memberId);
                          return (
                            <div className={`hostPanelItem ${isHost ? "host" : ""}`} key={memberId}>
                              <button
                                type="button"
                                className="hostPick"
                                aria-pressed={isHost}
                                onClick={() => void setMeetingHost(isHost ? null : memberId)}
                              >
                                {isHost ? "👑 " : ""}{member.name}
                              </button>
                              <button
                                type="button"
                                className={`hostOnline ${online ? "on" : ""}`}
                                aria-pressed={online}
                                title="온라인 참석"
                                onClick={() => void toggleOnline(memberId)}
                              >
                                💻
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="chipGrid compactChips">
                    {filteredAttendanceMembers.map((member) => {
                      const checked = selectedMeeting.attendeeIds.includes(member.id);
                      return (
                        <label className={`chip ${checked ? "active" : ""}`} key={member.id}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => void toggleAttendance(member.id)}
                          />
                          <span>{member.name}</span>
                        </label>
                      );
                    })}
                    {filteredAttendanceMembers.length === 0 && (
                      <div className="empty compactEmpty">검색 결과가 없습니다.</div>
                    )}
                  </div>

                  <div className="guestBlock">
                    <div className="guestToolbar">
                      <div className="inlineForm guestAdd">
                        <input
                          placeholder="게스트 이름"
                          value={newGuestName}
                          onChange={(event) => setNewGuestName(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void addGuest();
                          }}
                        />
                        <button className="smallButton" onClick={() => void addGuest()}>
                          게스트 추가
                        </button>
                      </div>
                      <label className="meetingSortControl guestSortControl">
                        <span>게스트 정렬</span>
                        <select
                          value={guestSort}
                          onChange={(event) => setGuestSort(event.target.value as GuestSort)}
                          aria-label="게스트 정렬"
                        >
                          <option value="nickname_asc">닉네임 가나다순</option>
                          <option value="nickname_desc">닉네임 역순</option>
                          <option value="added_desc">최근 추가순</option>
                          <option value="added_asc">먼저 추가순</option>
                        </select>
                      </label>
                    </div>

                    <div className="guestTags">
                      {sortedSelectedGuests.map((guest) => (
                        <span className="guestTag" key={guest.id}>
                          {guest.name}
                          <button onClick={() => void deleteGuest(guest)}>×</button>
                        </span>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="empty">모임을 선택해주세요.</div>
              )}
            </div>

            <div className="panel standalonePanel">
              <div className="panelHead compactHead">
                <div>
                  <h2>비용 배분</h2>
                  <p>선입금과 특정값을 해당 모임 기준으로 함께 관리합니다.</p>
                </div>
                {selectedMeeting && selectedMeeting.cost != null && (
                  <div className="shareControl">
                    <button
                      className="kakaoShareButton"
                      onClick={() => void shareSettlement(selectedMeeting)}
                    >
                      카카오톡 정산 공유
                    </button>
                  </div>
                )}
              </div>

              {!selectedMeeting ? (
                <div className="empty">모임을 선택해주세요.</div>
              ) : selectedMeeting.cost == null ? (
                <div className="empty">아래에서 모임 비용을 먼저 입력해주세요.</div>
              ) : selectedMeeting.attendeeIds.length + selectedMeeting.guests.length === 0 ? (
                <div className="empty">참석자 또는 게스트를 추가해주세요.</div>
              ) : (
                <>
                  <div className="allocationSummaryGrid allocationSummaryFour">
                    <div className="miniSummary">
                      <span>총 비용</span>
                      <strong>{won(selectedAllocation?.totalCost ?? 0)}</strong>
                    </div>
                    <div className="miniSummary">
                      <span>특정값</span>
                      <strong>{won(selectedAllocation?.fixedTotal ?? 0)}</strong>
                    </div>
                    <div className="miniSummary">
                      <span>자동 1/N</span>
                      <strong>
                        {selectedAllocation?.normalCount
                          ? won(selectedAllocation.normalShare)
                          : "-"}
                      </strong>
                    </div>
                    <div className="miniSummary">
                      <span>이 모임 선입금</span>
                      <strong>{won(selectedMeetingPrepaymentTotal)}</strong>
                    </div>
                  </div>

                  <div className="allocationScroll">
                    {selectedMeeting.attendeeIds.map((memberId) => {
                      const member = members.find((item) => item.id === memberId);
                      if (!member) return null;
                      const adjustment =
                        adjustmentByKey[`${selectedMeeting.id}:${memberId}`];
                      const draft =
                        memberFixedDrafts[memberId] ??
                        (adjustment ? String(adjustment.amount) : "");

                      return (
                        <div className="allocationCompactRow memberAllocationRow" key={`m-${memberId}`}>
                          <div className="allocationIdentity">
                            <strong>{member.name}</strong>
                            <span className="personType">회원</span>
                          </div>

                          <div className="allocationField">
                            <span>선입금</span>
                            <input
                              type="number"
                              min="0"
                              placeholder="0"
                              value={
                                prepaymentDrafts[memberId] ??
                                String(selectedPrepaymentByMember[memberId]?.amount ?? 0)
                              }
                              onChange={(event) =>
                                setPrepaymentDrafts((current) => ({
                                  ...current,
                                  [memberId]: event.target.value,
                                }))
                              }
                            />
                          </div>

                          <div className="allocationField">
                            <span>특정값</span>
                            <input
                              type="number"
                              min="0"
                              placeholder="자동 1/N"
                              value={draft}
                              onChange={(event) =>
                                setMemberFixedDrafts((current) => ({
                                  ...current,
                                  [memberId]: event.target.value,
                                }))
                              }
                            />
                          </div>

                          <button
                            className="tinyButton allocationSaveButton"
                            onClick={() => void saveMemberAllocation(memberId)}
                            disabled={saving}
                          >
                            저장
                          </button>

                          <div className="allocationAmount finalBurden">
                            <span>부담금</span>
                            <strong>
                              {won(
                                Math.max(
                                  0,
                                  (selectedAllocation?.shares[`m:${memberId}`] ?? 0) -
                                    Number(
                                      selectedPrepaymentByMember[memberId]?.amount ?? 0
                                    )
                                )
                              )}
                            </strong>
                            {Number(selectedPrepaymentByMember[memberId]?.amount ?? 0) >
                              (selectedAllocation?.shares[`m:${memberId}`] ?? 0) && (
                              <small>
                                초과 선입금{" "}
                                {won(
                                  Number(
                                    selectedPrepaymentByMember[memberId]?.amount ?? 0
                                  ) -
                                    (selectedAllocation?.shares[`m:${memberId}`] ?? 0)
                                )}
                              </small>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {selectedMeeting.guests.map((guest) => {
                      const draft =
                        guestFixedDrafts[guest.id] ??
                        (guest.fixed_amount == null ? "" : String(guest.fixed_amount));

                      return (
                        <div className="allocationCompactRow guestRow" key={`g-${guest.id}`}>
                          <div className="allocationIdentity">
                            <strong>{guest.name}</strong>
                            <span className="personType guest">게스트</span>
                          </div>

                          <div className="allocationAmount">
                            <span>부담금</span>
                            <strong>
                              {won(selectedAllocation?.shares[`g:${guest.id}`] ?? 0)}
                            </strong>
                          </div>

                          <div className="allocationField guestFixedField">
                            <span>특정값</span>
                            <input
                              type="number"
                              min="0"
                              placeholder="자동 1/N"
                              value={draft}
                              onChange={(event) =>
                                setGuestFixedDrafts((current) => ({
                                  ...current,
                                  [guest.id]: event.target.value,
                                }))
                              }
                            />
                          </div>

                          <div className="allocationRowActions guestActions">
                            <button
                              className="tinyButton"
                              onClick={() => void saveGuestFixed(guest)}
                            >
                              특정값 저장
                            </button>
                            {guest.fixed_amount != null && (
                              <button
                                className="tinyButton ghost"
                                onClick={() => void clearGuestFixed(guest.id)}
                              >
                                1/N 복귀
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panelHead compactHead">
              <div>
                <h2>등록된 모임 · 비용</h2>
                <p>선택 월 {monthMeetings.length}개</p>
              </div>
            </div>

            <div className="meetingCardGrid">
              {monthMeetings.map((meeting) => (
                <div className="meetingMiniCard" key={meeting.id}>
                  <div>
                    <strong>{meeting.title}</strong>
                    <div className="muted">
                      {meeting.date} · {meeting.attendeeIds.length + meeting.guests.length}명
                    </div>
                  </div>

                  <div className="meetingMiniActions">
                    <button
                      className="tinyButton ghost"
                      onClick={() => setDetailMeetingId(meeting.id)}
                    >
                      상세
                    </button>
                    <button
                      className="tinyButton ghost"
                      onClick={() => {
                        setSelectedMeetingId(meeting.id);
                        beginMeetingEdit(meeting);
                      }}
                    >
                      수정
                    </button>
                    <button
                      className="tinyButton ghost"
                      onClick={() => void copyMeeting(meeting)}
                      disabled={saving}
                    >
                      복사
                    </button>
                    <button
                      className="tinyButton dangerText"
                      onClick={() => void deleteMeeting(meeting)}
                      disabled={saving}
                    >
                      삭제
                    </button>
                  </div>

                  {editingCostId === meeting.id ? (
                    <div className="costEdit">
                      <input
                        type="number"
                        min="0"
                        value={editingCost}
                        placeholder="총 비용"
                        onChange={(event) => setEditingCost(event.target.value)}
                      />
                      <button className="tinyButton" onClick={() => void saveCost(meeting.id)}>
                        저장
                      </button>
                      <button
                        className="tinyButton ghost"
                        onClick={() => {
                          setEditingCostId("");
                          setEditingCost("");
                        }}
                      >
                        취소
                      </button>
                    </div>
                  ) : (
                    <button
                      className="costButton"
                      onClick={() => {
                        setEditingCostId(meeting.id);
                        setEditingCost(meeting.cost == null ? "" : String(meeting.cost));
                      }}
                    >
                      {meeting.cost == null ? "비용 입력" : won(Number(meeting.cost))}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {mainTab === "members" && (
        <>
          <section className="memberManagementHeader panel standalonePanel">
            <div className="memberManagementTitleRow">
              <div>
                <span className="memberControlEyebrow">MEMBERS</span>
                <h2>회원 현황</h2>
                <p>회원 검색, 정렬과 상태별 인원을 한 곳에서 확인합니다.</p>
              </div>
              {isAdmin && (
                <button
                  className={showAdminMemberAdd ? "smallButton ghost" : "smallButton memberAddToggleButton"}
                  onClick={() => setShowAdminMemberAdd((current) => !current)}
                >
                  {showAdminMemberAdd ? "닫기" : "+ 회원 추가"}
                </button>
              )}
            </div>

            {isAdmin && showAdminMemberAdd && (
              <div className="memberAddDrawer">
                <div className="memberAddDrawerHead">
                  <div>
                    <strong>새 회원 등록</strong>
                    <span>미리 명단에 등록하면 같은 닉네임으로 최초 가입할 때 계정이 연결됩니다.</span>
                  </div>
                </div>
                <div className="adminMemberAddForm memberAddDrawerForm">
                  <label>
                    <span>닉네임</span>
                    <input
                      value={newMemberName}
                      onChange={(event) => setNewMemberName(event.target.value)}
                      placeholder="회원 닉네임"
                      maxLength={20}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void addMemberByAdmin();
                      }}
                    />
                  </label>
                  <label>
                    <span>입장일</span>
                    <input
                      type="date"
                      value={newMemberJoinDate}
                      onChange={(event) => setNewMemberJoinDate(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>생일 <em className="optionalLabel">선택</em></span>
                    <input
                      type="date"
                      max={today}
                      value={newMemberBirthday}
                      onChange={(event) => setNewMemberBirthday(event.target.value)}
                    />
                  </label>
                  <button
                    className="primaryButton adminAddMemberButton"
                    onClick={() => void addMemberByAdmin()}
                    disabled={saving}
                  >
                    {saving ? "추가 중..." : "등록"}
                  </button>
                </div>
              </div>
            )}

            <div className="memberSearchBar">
              <label className="memberSearchControl">
                <span>닉네임 검색</span>
                <input
                  className="searchInput"
                  type="search"
                  placeholder="찾을 회원의 닉네임을 입력하세요"
                  value={memberSearch}
                  onChange={(event) => setMemberSearch(event.target.value)}
                />
              </label>

              <label className="memberSortControl">
                <span>정렬 기준</span>
                <select
                  value={memberSort}
                  onChange={(event) => setMemberSort(event.target.value as MemberSort)}
                  aria-label="회원 정렬"
                >
                  <option value="nickname_asc">닉네임 가나다순</option>
                  <option value="nickname_desc">닉네임 역순</option>
                  <option value="join_desc">입장일 최신순</option>
                  <option value="join_asc">입장일 오래된순</option>
                  <option value="last_desc">최근 참석일 최신순</option>
                  <option value="last_asc">최근 참석일 오래된순</option>
                  <option value="points_desc">카톡 점수 높은순</option>
                  <option value="chat_desc">최근 채팅 최신순</option>
                  <option value="chat_asc">최근 채팅 오래된순</option>
                </select>
              </label>
            </div>

            <div className="memberStatusSection">
              <div className="memberStatusTitleLine">
                <span className="memberToolbarLabel">회원 상태</span>
                <small>전체 {memberStatusCounts.all}명 = 활동중 {memberStatusCounts.active}명 + 경고 {memberStatusCounts.warning}명 · 탈퇴 제외</small>
              </div>
              {botPointsSyncedAt && (
                <small className="muted">
                  💎 카톡 점수는 봇 점수판 기준 · {new Date(botPointsSyncedAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 갱신
                </small>
              )}

              <div className="memberStatusSummary">
                {[
                  ["all", "전체", memberStatusCounts.all],
                  ["active", "활동중", memberStatusCounts.active],
                  ["warning", "경고", memberStatusCounts.warning],
                  ["withdrawn", "탈퇴", memberStatusCounts.withdrawn],
                ].map(([value, label, count]) => (
                  <button
                    key={String(value)}
                    className={`memberStatusCard ${value} ${memberFilter === value ? "active" : ""}`}
                    onClick={() => setMemberFilter(value as MemberFilter)}
                  >
                    <span>{label}</span>
                    <strong>{count}<em>명</em></strong>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="memberCards">
            {filteredMembers.length === 0 && (
              <div className="emptyStateCard">
                <strong>조건에 맞는 회원이 없습니다.</strong>
                <span>검색어 또는 회원 상태 필터를 변경해보세요.</span>
                <button
                  className="tinyButton ghost"
                  onClick={() => {
                    setMemberSearch("");
                    setMemberFilter("all");
                  }}
                >
                  필터 초기화
                </button>
              </div>
            )}
            {filteredMembers.map((member) => {
              const warning = warningByMember[member.id];
              const last = lastAttendanceByMember[member.id];
              const profile = profiles.find((item) => item.member_id === member.id);
              const point = pointsByMember[member.id];
              // 마지막 채팅: 3일 이상 주황, 5일 이상 빨강 (기록이 아예 없으면 표시하지 않음)
              const chatAt = lastChats[member.name];
              const chatDays = chatAt ? Math.floor((Date.now() - new Date(chatAt).getTime()) / 86400000) : -1;
              const chatLevel = chatDays >= 5 ? "red" : chatDays >= 3 ? "orange" : "";
              const red = Boolean(warning?.warning) || chatLevel === "red";
              const orange = !red && chatLevel === "orange";

              return (
                <article
                  className={`memberCard ${
                    !member.active ? "withdrawn" : red ? "warning" : orange ? "chatIdle" : ""
                  }`}
                  key={member.id}
                >
                  <div className="memberTop">
                    <div>
                      <div className="memberNameLine">
                        <button
                          className="memberNameButton"
                          onClick={() => setMemberDetailId(member.id)}
                        >
                          {member.name}
                        </button>
                        {point ? (
                          <span className="botPointBadge" title="카톡 봇 점수판 기준">
                            <strong>💎 {point.exp.toLocaleString("ko-KR")}점</strong>
                            {point.rank ? <em>{point.rank}위</em> : null}
                            {point.tickets ? <em>🎫{point.tickets}</em> : null}
                            {point.trophies ? <em>{point.trophies}</em> : null}
                          </span>
                        ) : botPoints.length > 0 ? (
                          <span className="botPointBadge empty">💎 점수 없음</span>
                        ) : null}
                        <span className={`statusBadge ${member.active ? "active" : "withdrawn"}`}>
                          {member.active ? "활동중" : "탈퇴"}
                        </span>
                        {member.active && red && (
                          <span className="warningBadge">⚠ 확인 필요</span>
                        )}
                      </div>
                      <div className="metaLine">
                        <span>입장 {member.join_date}</span>
                        <span>생일 {member.birthday ? member.birthday.slice(5).replace("-", ".") : "미입력"}</span>
                        <span>최근 {last ?? "없음"}</span>
                        {!member.active && member.withdrawn_at && (
                          <span>탈퇴 {member.withdrawn_at}</span>
                        )}
                      </div>
                      {member.active && (
                        <div className={`memberActivityLine ${red ? "warningText" : orange ? "chatIdleText" : "muted"}`}>
                          <span>
                            <span className={warning?.warning ? "warningText" : ""}>{warning?.text}</span>
                            {" · "}
                            <span className={chatLevel === "red" ? "warningText" : chatLevel === "orange" ? "chatIdleText" : ""}>
                              마지막 채팅 {chatAgo(chatAt)}
                            </span>
                          </span>
                          {(isAdmin || currentMember?.id === member.id) && (
                            <button
                              type="button"
                              className="chatLogButton"
                              title="채팅 내역 보기"
                              aria-label={`${member.name} 채팅 내역`}
                              onClick={() => setChatLogName(member.name)}
                            >
                              📜
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="actions memberAdminActions">
                      {profile && (
                        <span className={`accountBadge ${profile.role}`}>
                          {profile.role === "owner"
                            ? "제작자"
                            : profile.role === "admin"
                              ? "관리자"
                              : "회원"}
                        </span>
                      )}

                      {(isAdmin || (isOwner && profile && profile.role !== "owner")) && (
                        <div className="memberMoreMenuWrap">
                          <button
                            className="memberMoreButton"
                            aria-label={`${member.name} 회원 관리`}
                            onClick={() =>
                              setOpenMemberMenuId((current) => current === member.id ? "" : member.id)
                            }
                          >
                            ⋯
                          </button>

                          {openMemberMenuId === member.id && (
                            <div className="memberMoreMenu">
                              <button
                                onClick={() => {
                                  setMemberDetailId(member.id);
                                  setOpenMemberMenuId("");
                                }}
                              >
                                회원 상세
                              </button>
                              {isAdmin && (
                                <>
                                  <button
                                    onClick={() => {
                                      void toggleMemberStatus(member);
                                      setOpenMemberMenuId("");
                                    }}
                                  >
                                    {member.active ? "탈퇴 처리" : "회원 복귀"}
                                  </button>
                                  <button
                                    onClick={() => {
                                      setEditingNicknameId(member.id);
                                      setEditingNickname(member.name);
                                      setEditingJoinId("");
                                      setEditingJoinDate("");
                                      setOpenMemberMenuId("");
                                    }}
                                  >
                                    닉네임 변경
                                  </button>
                                  <button
                                    onClick={() => {
                                      setEditingJoinId(member.id);
                                      setEditingJoinDate(member.join_date);
                                      setEditingNicknameId("");
                                      setEditingNickname("");
                                      setOpenMemberMenuId("");
                                    }}
                                  >
                                    입장일 변경
                                  </button>
                                  <button
                                    onClick={() => {
                                      setEditingBirthdayId(member.id);
                                      setEditingBirthday(member.birthday ?? "");
                                      setEditingNicknameId("");
                                      setEditingNickname("");
                                      setEditingJoinId("");
                                      setEditingJoinDate("");
                                      setOpenMemberMenuId("");
                                    }}
                                  >
                                    생일 변경
                                  </button>
                                </>
                              )}
                              {isOwner && profile && profile.role !== "owner" && (
                                <button
                                  onClick={() => {
                                    void changeMemberRole(
                                      member.id,
                                      profile.role === "admin" ? "user" : "admin"
                                    );
                                    setOpenMemberMenuId("");
                                  }}
                                >
                                  {profile.role === "admin" ? "관리자 해제" : "관리자 지정"}
                                </button>
                              )}
                              {isAdmin && (
                                <button
                                  className="danger"
                                  onClick={() => {
                                    void deleteMemberByAdmin(member);
                                    setOpenMemberMenuId("");
                                  }}
                                  disabled={saving || profile?.role === "owner" || currentMember?.id === member.id}
                                >
                                  회원 삭제
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {isAdmin && editingNicknameId === member.id && (
                    <div className="editRow memberNicknameEditRow">
                      <input
                        value={editingNickname}
                        onChange={(event) => setEditingNickname(event.target.value)}
                        placeholder="새 닉네임"
                        maxLength={20}
                        autoFocus
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void saveMemberNickname(member);
                          if (event.key === "Escape") {
                            setEditingNicknameId("");
                            setEditingNickname("");
                          }
                        }}
                      />
                      <button
                        className="tinyButton"
                        onClick={() => void saveMemberNickname(member)}
                        disabled={saving}
                      >
                        저장
                      </button>
                      <button
                        className="tinyButton ghost"
                        onClick={() => {
                          setEditingNicknameId("");
                          setEditingNickname("");
                        }}
                      >
                        취소
                      </button>
                    </div>
                  )}

                  {isAdmin && editingJoinId === member.id && (
                    <div className="editRow">
                      <input
                        type="date"
                        value={editingJoinDate}
                        onChange={(event) => setEditingJoinDate(event.target.value)}
                      />
                      <button className="tinyButton" onClick={() => void saveJoinDate(member.id)}>
                        저장
                      </button>
                      <button
                        className="tinyButton ghost"
                        onClick={() => {
                          setEditingJoinId("");
                          setEditingJoinDate("");
                        }}
                      >
                        취소
                      </button>
                    </div>
                  )}

                  {isAdmin && editingBirthdayId === member.id && (
                    <div className="editRow memberBirthdayEditRow">
                      <input
                        type="date"
                        max={today}
                        value={editingBirthday}
                        onChange={(event) => setEditingBirthday(event.target.value)}
                      />
                      <button className="tinyButton" onClick={() => void saveBirthday(member.id)}>
                        저장
                      </button>
                      <button
                        className="tinyButton ghost"
                        onClick={() => {
                          setEditingBirthdayId("");
                          setEditingBirthday("");
                        }}
                      >
                        취소
                      </button>
                    </div>
                  )}

                </article>
              );
            })}
          </section>

          {chatLogName && <ChatLogModal name={chatLogName} onClose={() => setChatLogName("")} />}

          {guestMembers.length > 0 && (
            <section className="panel standalonePanel guestPanel">
              <div className="guestPanelHead">
                <div>
                  <h3>🙋 게스트 현황</h3>
                  <p>카톡방 명단에 없는 닉네임으로 가입한 사람들입니다. 방에 규칙 닉네임으로 들어오면 자동으로 회원이 됩니다.</p>
                </div>
                <span className="guestCount">{guestMembers.length}명</span>
              </div>
              <div className="guestList">
                {guestMembers.map((member) => {
                  const last = lastAttendanceByMember[member.id];
                  const hasAccount = profiles.some((item) => item.member_id === member.id);
                  return (
                    <div className="guestRow" key={member.id}>
                      <div>
                        <strong>{member.name}</strong>
                        <span>
                          가입 {member.join_date} · 최근 참석 {last ?? "없음"}
                          {hasAccount ? " · 로그인 계정 있음" : ""}
                        </span>
                      </div>
                      {isAdmin && (
                        <button className="smallButton ghost" onClick={() => void promoteGuest(member)}>
                          정회원 전환
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}

      {mainTab === "monthly" && (
        <>
          <section className="summaryGrid">
            <div className="summaryCard">
              <span>조회 월</span>
              <strong>{selectedMonth}</strong>
            </div>
            <div className="summaryCard">
              <span>모임</span>
              <strong>{monthMeetings.length}회</strong>
              <small>게스트 {monthGuestTotal}명</small>
            </div>
            <div className="summaryCard">
              <span>총 참석</span>
              <strong>{monthAttendanceTotal}명</strong>
              <small>회원 + 게스트</small>
            </div>
            <div className="summaryCard">
              <span>모임 총비용</span>
              <strong>{won(monthTotalCost)}</strong>
            </div>
          </section>

          <section className="panel monthlyRankPanel">
            <div className="panelHead compactHead">
              <div>
                <h2>이번 달 참석 TOP</h2>
                <p>참석 횟수 기준</p>
              </div>
            </div>
            <div className="rankList">
              {topAttendance.map((item) => (
                <button
                  key={item.member.id}
                  onClick={() => setMemberDetailId(item.member.id)}
                >
                  <span>{item.displayRank === 1 ? "🥇" : item.displayRank === 2 ? "🥈" : item.displayRank === 3 ? "🥉" : item.displayRank}</span>
                  <strong>{item.member.name}</strong>
                  <em>{item.attendanceCount}회</em>
                </button>
              ))}
              {topAttendance.length === 0 && (
                <div className="empty">이번 달 참석 기록이 없습니다.</div>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panelHead compactHead">
              <div>
                <h2>월별 참석 현황</h2>
                <p>{selectedMonth} 기준 참석 및 비용 현황입니다.</p>
                {/* 조회 월 바꾸기 (머리말의 조회 월과 같이 바뀐다) */}
                <div className="monthStepper">
                  <button className="tinyButton ghost" onClick={() => setSelectedMonth(shiftMonth(selectedMonth, -1))} aria-label="이전 달">
                    ◀
                  </button>
                  <label className="monthStepperLabel">
                    <strong>
                      {selectedMonth.slice(0, 4)}년 {Number(selectedMonth.slice(5, 7))}월
                    </strong>
                    <input
                      type="month"
                      value={selectedMonth}
                      onChange={(event) => event.target.value && setSelectedMonth(event.target.value)}
                      aria-label="조회 월 선택"
                    />
                  </label>
                  <button className="tinyButton ghost" onClick={() => setSelectedMonth(shiftMonth(selectedMonth, 1))} aria-label="다음 달">
                    ▶
                  </button>
                  {selectedMonth !== currentMonth && (
                    <button className="tinyButton ghost" onClick={() => setSelectedMonth(currentMonth)}>이번 달</button>
                  )}
                </div>
              </div>
              <div className="exportActions">
                <button className="tinyButton ghost" onClick={exportMonthlyCsv}>
                  CSV 내보내기
                </button>
                {isAdmin && (
                  <button className="tinyButton ghost" onClick={exportBackupJson}>
                    운영자 백업 JSON
                  </button>
                )}
              </div>
            </div>

            {isAdmin && (
              <div className="noticeBar">
                <span>📢 참석 안내 (카톡방 멘션) · 자동 오전 10시: 참석 경고 7일 전·3일 전 / 미채팅 3일째·4일째 · 경고 = 참석 경고 + 미채팅 3일↑</span>
                <div>
                  <button
                    type="button"
                    className="tinyButton"
                    disabled={noticeBusy || noticePick.length === 0}
                    onClick={() => void sendAttendanceNotice(noticePick, "선택한 회원")}
                  >
                    선택 {noticePick.length}명 알림
                  </button>
                  <button
                    type="button"
                    className="tinyButton danger"
                    disabled={noticeBusy || noticeTargets.length === 0}
                    onClick={() => void sendAttendanceNotice(noticeTargets.map((member) => member.id), "경고 회원 전체")}
                  >
                    경고 전체 알림 ({noticeTargets.length}명)
                  </button>
                </div>
              </div>
            )}

            <div className="tableWrap">
              <table className="monthlyTable attendanceOnlyTable">
                <thead>
                  <tr>
                    {isAdmin && (
                      <th className="noticeCol">
                        <input
                          type="checkbox"
                          aria-label="경고 회원 모두 선택"
                          title="경고 회원 모두 선택"
                          checked={noticeTargets.length > 0 && noticeTargets.every((member) => noticePick.includes(member.id))}
                          onChange={(event) =>
                            setNoticePick(event.target.checked ? noticeTargets.map((member) => member.id) : [])
                          }
                        />
                      </th>
                    )}
                    {[
                      ["member", "회원"],
                      ["status", "상태"],
                      ["join", "최초 입장"],
                      ["attendance", "월 참석"],
                      ["last", "최근 참석"],
                      ["burden", "월 부담금"],
                      ["warning", "경고"],
                    ].map(([key, label]) => (
                      <th key={key}>
                        <button
                          type="button"
                          className={`monthlySortButton ${
                            monthlySortKey === key ? "active" : ""
                          }`}
                          onClick={() => toggleMonthlySort(key as MonthlySortKey)}
                          aria-label={`${label} 정렬`}
                        >
                          <span>{label}</span>
                          <em>{monthlySortIndicator(key as MonthlySortKey)}</em>
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedMonthStats.map(({ member, attendanceCount, expectedAmount }) => (
                    <tr key={member.id}>
                      {isAdmin && (
                        <td className="noticeCol">
                          {member.active && (
                            <span className="noticeCell">
                              <input
                                type="checkbox"
                                aria-label={`${member.name} 선택`}
                                checked={noticePick.includes(member.id)}
                                onChange={(event) =>
                                  setNoticePick((current) =>
                                    event.target.checked ? [...current, member.id] : current.filter((id) => id !== member.id),
                                  )
                                }
                              />
                              <button
                                type="button"
                                className="noticeOne"
                                title={`${member.name}님에게 참석 안내`}
                                disabled={noticeBusy}
                                onClick={() => void sendAttendanceNotice([member.id], member.name)}
                              >
                                📢
                              </button>
                            </span>
                          )}
                        </td>
                      )}
                      <td><strong>{member.name}</strong></td>
                      <td>
                        <span className={`statusBadge ${member.active ? "active" : "withdrawn"}`}>
                          {member.active ? "활동중" : "탈퇴"}
                        </span>
                      </td>
                      <td>{member.join_date}</td>
                      <td>{attendanceCount}회</td>
                      <td>{lastAttendanceByMember[member.id] ?? "-"}</td>
                      <td>{won(expectedAmount)}</td>
                      <td>
                        {member.active && warningByMember[member.id]?.warning ? (
                          <span className="warningText inlineWarning">
                            {warningByMember[member.id].text}
                          </span>
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}


      {mainTab === "history" && (
        <section className="historyPage">
          <section className="panel standalonePanel historyHeaderPanel">
            <div>
              <span className="historyKicker">ACTIVITY LOG</span>
              <h2>최근 변경 이력</h2>
              <p>회원·모임·정산 관련 최근 변경 내용을 시간순으로 확인합니다.</p>
            </div>
            <strong>{activityLogs.length}건</strong>
          </section>

          <section className="panel activityPanel historyActivityPanel">
            <div className="panelHead compactHead">
              <div>
                <h2>최근 활동</h2>
                <p>최근 20건 · 모든 역할에서 동일하게 확인</p>
              </div>
            </div>
            <div className="activityList">
              {activityLogs.map((log) => (
                <div className="activityRow" key={log.id}>
                  <div>
                    <strong>{log.action}</strong>
                    <span>{log.description}</span>
                  </div>
                  <div className="activityMeta">
                    <strong>{log.actor_nickname}</strong>
                    <span>
                      {new Date(log.created_at).toLocaleString("ko-KR", {
                        year: "numeric",
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                </div>
              ))}
              {activityLogs.length === 0 && (
                <div className="empty">아직 기록된 변경 이력이 없습니다.</div>
              )}
            </div>
          </section>
        </section>
      )}

      {mainTab === "help" && (
        <section className="helpPage">
          <div className="helpHero panel standalonePanel">
            <div>
              <div className="kicker">USER GUIDE</div>
              <h2>사용방법</h2>
              <p>
                현재 로그인한 권한에 맞는 기능만 안내합니다.
              </p>
            </div>
            <span className={`roleBadge ${currentRole ?? "user"} helpRoleBadge`}>
              {currentRole === "owner"
                ? "제작자"
                : currentRole === "admin"
                  ? "관리자"
                  : "일반회원"}
            </span>
          </div>

          <div className="helpGrid">
            <article className="panel helpCard">
              <div className="helpStepNumber">01</div>
              <h3>로그인 · 내 계정</h3>
              <p>
                가입한 닉네임과 비밀번호로 로그인합니다. 처음 사용하는 회원은
                <strong> 최초 가입</strong>에서 본인의 닉네임과 비밀번호를 직접 설정합니다.
              </p>
              <p>
                관리자가 회원을 미리 등록했다면 반드시 <strong>등록된 닉네임과 동일하게</strong>
                최초 가입해야 기존 입장일과 참석 기록에 계정이 연결됩니다.
              </p>
              <p>상단의 <strong>내 계정</strong>에서 비밀번호를 변경할 수 있습니다.</p>
            </article>

            <article className="panel helpCard">
              <div className="helpStepNumber">02</div>
              <h3>대시보드 · 내 현황</h3>
              <p>
                대시보드에서 활동 회원, 이번 달 모임, 총비용, 참석 순위를 확인합니다.
              </p>
              <p>
                상단의 <strong>내 현황 · 상세보기</strong>에서는 본인의 월 참석 횟수,
                벙비 합계, 입장일, 최근 참석일과 참석 모임별 부담금을 확인할 수 있습니다.
              </p>
            </article>

            <article className="panel helpCard">
              <div className="helpStepNumber">03</div>
              <h3>모임 관리 · 비용 배분</h3>
              <p>
                모임을 선택하면 참석자, 게스트, 비용을 관리할 수 있습니다. 비용은 기본적으로
                참석 인원 기준 1/N으로 계산되며 필요한 경우 회원별 <strong>특정값</strong>을
                입력할 수 있습니다.
              </p>
              <p>
                <strong>선입금</strong>은 해당 모임의 비용 배분 영역에서만 관리하며,
                정산 금액에서 자동 차감됩니다.
              </p>
            </article>

            <article className="panel helpCard">
              <div className="helpStepNumber">04</div>
              <h3>카카오톡 정산 공유</h3>
              <p>
                모임 비용과 참석자 입력이 끝나면 <strong>카카오톡 정산 공유</strong>를 누릅니다.
                공유 문구는 카톡 꾸밈형으로 고정되어 실제 줄바꿈 형태로 전달됩니다.
              </p>
              <div className="helpSharePreview">
                <span>📌 강서구 찐친만들기 벙비 정산</span>
                <span>━━━━━━━━━━━━━━</span>
                <span>📅 모임 날짜</span>
                <span>🍻 모임명</span>
                <span>💰 총 비용</span>
                <span>👥 참석 인원</span>
                <span>&nbsp;</span>
                <span>• 회원명 : 정산금액</span>
              </div>
            </article>
          </div>

          {currentRole === "user" && (
            <section className="panel helpPermissionPanel">
              <div className="helpPermissionHead">
                <div>
                  <span className="helpPermissionLabel">일반회원 가이드</span>
                  <h2>내 모임과 정산을 확인하고 관리합니다</h2>
                </div>
              </div>
              <div className="helpPermissionGrid">
                <div>
                  <strong>사용 가능</strong>
                  <p>대시보드 및 내 현황 조회</p>
                  <p>모임 생성 · 수정 · 삭제 · 복사</p>
                  <p>참석자 · 게스트 관리</p>
                  <p>비용 배분 · 특정값 · 선입금 입력</p>
                  <p>카카오톡 정산 공유</p>
                  <p>회원 및 월별 참석 현황 조회</p>
                  <p>월별 CSV 내보내기</p>
                </div>
                <div>
                  <strong>관리자 전용</strong>
                  <p>회원 추가</p>
                  <p>회원 탈퇴 · 복귀</p>
                  <p>회원 입장일 수정</p>
                  <p>운영자 백업 JSON</p>
                  <p>관리자 지정 · 해제</p>
                </div>
              </div>
            </section>
          )}

          {currentRole === "admin" && (
            <>
              <section className="panel helpPermissionPanel">
                <div className="helpPermissionHead">
                  <div>
                    <span className="helpPermissionLabel">관리자 가이드</span>
                    <h2>회원 명단과 운영 상태를 관리합니다</h2>
                  </div>
                </div>
                <div className="helpAdminSteps">
                  <div>
                    <strong>회원 추가</strong>
                    <p>
                      회원 현황 상단에서 닉네임과 입장일을 입력합니다. 해당 회원은 이후
                      같은 닉네임으로 최초 가입하면 로그인 계정이 자동 연결됩니다.
                    </p>
                  </div>
                  <div>
                    <strong>탈퇴 · 복귀</strong>
                    <p>
                      회원 카드에서 탈퇴 또는 복귀를 선택합니다. 탈퇴 회원은 로그인할 수 없습니다.
                    </p>
                  </div>
                  <div>
                    <strong>입장일 수정</strong>
                    <p>회원 카드의 입장일 버튼을 눌러 날짜를 변경하고 저장합니다.</p>
                  </div>
                  <div>
                    <strong>운영자 백업</strong>
                    <p>
                      월별 참석 현황의 운영자 백업 JSON으로 회원·모임·비용조정·선입금 정보를
                      내려받을 수 있습니다.
                    </p>
                  </div>
                </div>
              </section>
              <div className="helpNote">
                관리자 지정 및 해제는 제작자(owner)만 가능합니다.
              </div>
            </>
          )}

          {currentRole === "owner" && (
            <>
              <section className="panel helpPermissionPanel ownerHelpPanel">
                <div className="helpPermissionHead">
                  <div>
                    <span className="helpPermissionLabel">제작자(owner) 가이드</span>
                    <h2>전체 운영과 관리자 권한을 관리합니다</h2>
                  </div>
                </div>
                <div className="helpAdminSteps">
                  <div>
                    <strong>회원 관리</strong>
                    <p>관리자와 동일하게 회원 추가, 탈퇴·복귀, 입장일 수정을 사용할 수 있습니다.</p>
                  </div>
                  <div>
                    <strong>관리자 지정</strong>
                    <p>
                      회원 현황에서 로그인 계정이 연결된 회원의 <strong>관리자 지정</strong>을 누릅니다.
                    </p>
                  </div>
                  <div>
                    <strong>관리자 해제</strong>
                    <p>관리자 회원의 관리자 해제를 누르면 일반회원 권한으로 돌아갑니다.</p>
                  </div>
                  <div>
                    <strong>운영자 백업</strong>
                    <p>월별 참석 현황에서 운영자 백업 JSON을 내려받을 수 있습니다.</p>
                  </div>
                </div>
              </section>

              <section className="panel helpSecurityPanel">
                <h3>제작자 보안 안내</h3>
                <p>
                  <strong>CREATOR_SETUP_KEY</strong>와 <strong>SUPABASE_SERVICE_ROLE_KEY</strong>는
                  일반 회원에게 공유하지 마세요. 제작자 권한은 앱 화면에서 다른 역할로 변경되지
                  않도록 보호되어 있습니다.
                </p>
              </section>
            </>
          )}

          <section className="panel helpTips">
            <h3>비용 배분 예시</h3>
            <div className="helpExampleGrid">
              <div>
                <span>기본 1/N</span>
                <strong>100,000원 ÷ 4명</strong>
                <p>각 25,000원</p>
              </div>
              <div>
                <span>특정값 적용</span>
                <strong>A 회원 10,000원 고정</strong>
                <p>남은 90,000원을 나머지 인원이 1/N</p>
              </div>
              <div>
                <span>선입금 적용</span>
                <strong>부담금 30,000원</strong>
                <p>선입금 10,000원 → 정산 20,000원</p>
              </div>
            </div>
          </section>

          <div className="helpVersion">사용방법 · Step 26 기준</div>
        </section>
      )}

      <footer className="siteFooter">Made by. 퐁당</footer>

      {loading && <div className="loading">불러오는 중...</div>}

      {botPoints.length > 0 && (
        <div className="floatingActions">
          <button
            className="pointRankingFab"
            onClick={() => setShowPointRanking(true)}
            aria-label="카톡 점수 순위 보기"
          >
            <span aria-hidden="true">🏆</span>
            <strong>점수순위</strong>
          </button>
          {currentMember && (
            <button
              className="pointRankingFab omokFab"
              onClick={() => setShowGames(true)}
              aria-label="게임"
            >
              <span aria-hidden="true">🎮</span>
              <strong>게임</strong>
            </button>
          )}
        </div>
      )}

      {showGames && currentMember && (
        <GameHub
          onClose={() => {
            setShowGames(false);
            if (gameInvite) {
              setGameInvite(null);
              try {
                window.sessionStorage.removeItem("gameInvite");
              } catch {
                // 무시
              }
              window.history.replaceState(null, "", window.location.pathname);
            }
          }}
          initial={gameInvite}
          isAdmin={isAdmin}
          currentMemberId={currentMember.id}
          myPoints={pointsByMember[currentMember.id]?.exp ?? null}
          myTickets={pointsByMember[currentMember.id]?.tickets ?? null}
          myName={currentMember.name}
          opponents={members
            .filter((member) => member.active && member.id !== currentMember.id && pointsByMember[member.id])
            .map((member) => ({ id: member.id, name: member.name }))
            .sort((a, b) => a.name.localeCompare(b.name, "ko"))}
        />
      )}

      {showPointRanking && (
        <div
          className="meetingModalBackdrop"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) setShowPointRanking(false);
          }}
        >
          <section className="meetingModal pointRankingModal" role="dialog" aria-modal="true">
            <div className="meetingModalHeader">
              <div>
                <span>
                  카톡 봇 점수판{pointRanking.season ? ` · 시즌 ${pointRanking.season}` : ""}
                </span>
                <h2>🏆 점수 순위</h2>
              </div>
              <button className="modalCloseButton" onClick={() => setShowPointRanking(false)}>×</button>
            </div>

            {pointRanking.rows.length >= 3 && (
              <div className="pointPodium">
                {[1, 0, 2].map((index) => {
                  const row = pointRanking.rows[index];
                  return (
                    <div key={row.kakao_uid} className={`pointPodiumItem place${row.place}`}>
                      <span className="pointPodiumMedal">{["🥇", "🥈", "🥉"][index]}</span>
                      <strong>{row.name}</strong>
                      <em>{row.exp.toLocaleString("ko-KR")}점</em>
                    </div>
                  );
                })}
              </div>
            )}

            <ol className="pointRankingList">
              {pointRanking.rows.map((row) => {
                const isMe = !!currentMember && pointsByMember[currentMember.id]?.kakao_uid === row.kakao_uid;
                return (
                  <li key={row.kakao_uid} className={isMe ? "me" : ""}>
                    <span className={`pointRankNo ${row.place <= 3 ? "top" : ""}`}>{row.place}</span>
                    <span className="pointRankName">
                      <strong>{row.name}</strong>
                      {isMe && <em className="pointRankMe">나</em>}
                      {row.trophies && <em className="pointRankTrophies">{row.trophies}</em>}
                    </span>
                    <span className="pointRankScore">
                      <strong>{row.exp.toLocaleString("ko-KR")}</strong>
                      <em>점{row.tickets ? ` · 🎫${row.tickets}` : ""}</em>
                    </span>
                  </li>
                );
              })}
            </ol>

            <p className="pointRankingFoot">
              {pointRanking.hidden > 0 && `💤 7일 이상 미활동 ${pointRanking.hidden}명 숨김 · `}
              {botPointsSyncedAt &&
                `${new Date(botPointsSyncedAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 갱신 · 1분마다 반영`}
            </p>
          </section>
        </div>
      )}
    
      {showMyActivity && currentMember && (
        <div className="meetingModalBackdrop" role="presentation">
          <section className="meetingModal" role="dialog" aria-modal="true">
            <div className="meetingModalHeader">
              <div>
                <span>{selectedMonth}</span>
                <h2>{currentNickname} · 내 활동</h2>
              </div>
              <button className="modalCloseButton" onClick={() => setShowMyActivity(false)}>×</button>
            </div>

            <div className="modalSummaryGrid">
              <div><span>이번 달 참석</span><strong>{myMonthSummary.attendance}회</strong></div>
              <div><span>벙비 합계</span><strong>{showDashboardCosts ? won(myMonthSummary.burden) : "••••••원"}</strong></div>
              <div><span>입장일</span><strong>{currentMember.join_date}</strong></div>
              <div><span>최근 참석</span><strong>{lastAttendanceByMember[currentMember.id] ?? "-"}</strong></div>
            </div>

            <div className="myActivityQuickGrid">
              <div><span>누적 참석</span><strong>{myAllMeetings.length}회</strong></div>
              <div><span>다음 예정</span><strong>{myUpcomingMeetings[0]?.date ?? "없음"}</strong></div>
              <div><span>상태</span><strong>{warningByMember[currentMember.id]?.warning ? "경고" : "활동중"}</strong></div>
            </div>
            {myUpcomingMeetings.length > 0 && <div className="modalSection"><div className="modalSectionHead"><strong>다음 참석 예정</strong><span>{myUpcomingMeetings.length}건</span></div><div className="myActivityList">{myUpcomingMeetings.map(meeting => <button key={meeting.id} onClick={() => {setShowMyActivity(false);setDetailMeetingId(meeting.id);}}><div><strong>{meeting.title}</strong><span>{meeting.date}</span></div><strong>›</strong></button>)}</div></div>}

            <div className="modalSection">
              <div className="modalSectionHead">
                <strong>이번 달 참석 모임</strong>
                <span>{myMeetingRows.length}건</span>
              </div>
              <div className="myActivityList">
                {myMeetingRows.map(({ meeting, share }) => (
                  <button
                    key={meeting.id}
                    onClick={() => {
                      setShowMyActivity(false);
                      setDetailMeetingId(meeting.id);
                    }}
                  >
                    <div>
                      <strong>{meeting.title}</strong>
                      <span>{meeting.date}</span>
                    </div>
                    <strong>{won(share)}</strong>
                  </button>
                ))}
                {myMeetingRows.length === 0 && <div className="empty">참석한 모임이 없습니다.</div>}
              </div>
            </div>
          </section>
        </div>
      )}

      {showAccountPanel && (
        <div className="meetingModalBackdrop" role="presentation">
          <section className="meetingModal accountModal" role="dialog" aria-modal="true">
            <div className="meetingModalHeader">
              <div>
                <span>내 계정</span>
                <h2>{currentNickname}</h2>
              </div>
              <button className="modalCloseButton" onClick={() => setShowAccountPanel(false)}>×</button>
            </div>

            <div className="accountRoleRow">
              <span>권한</span>
              <strong>
                {currentRole === "owner" ? "제작자" : currentRole === "admin" ? "관리자" : "일반회원"}
              </strong>
            </div>
<div className="petLinkCard">
  <div className="petLinkHeader">
    <div>
      <strong>찐친 PET 연동</strong>
      <span>모임 참석 보상을 PET에서 받아보세요.</span>
    </div>

    {petLinkStatus?.linked && (
      <span className="petLinkBadge">연동 완료</span>
    )}
  </div>

  {petLinkLoading ? (
    <div className="petLinkLoading">
      PET 연동 상태를 확인하고 있습니다.
    </div>
  ) : petLinkError ? (
    <div className="petLinkError">
      <span>{petLinkError}</span>
      <button
        type="button"
        className="smallButton"
        onClick={() => void loadPetLinkStatus()}
      >
        다시 확인
      </button>
    </div>
  ) : petLinkStatus?.linked ? (
    <>
      <div className="petLinkAccountGrid">
        <div>
          <span>모임 닉네임</span>
          <strong>
            {petLinkStatus.meetingNickname ?? currentNickname}
          </strong>
        </div>
        <div>
          <span>PET 닉네임</span>
          <strong>
            {petLinkStatus.petNickname ??
              petLinkStatus.externalNickname ??
              "-"}
          </strong>
        </div>
      </div>

      <div className="petLinkSuccess">
        ✓ PET 계정과 연동되어 있습니다.
      </div>

      <div className="petRewardInfo">
        <strong>모임 참석 시 자동 보상</strong>

        <div>
          <span>EXP</span>
          <b>+50</b>
        </div>
        <div>
          <span>친밀도</span>
          <b>+10</b>
        </div>
        <div>
          <span>PET Coin</span>
          <b>+100</b>
        </div>
        <div>
          <span>모임상자</span>
          <b>+1</b>
        </div>
      </div>
    </>
  ) : (
    <>
      <div className="petLinkAccountGrid">
        <div>
          <span>모임 닉네임</span>
          <strong>{currentNickname}</strong>
        </div>
        <div>
          <span>PET 닉네임</span>
          <strong>미연동</strong>
        </div>
      </div>

      <p className="petLinkDescription">
        PET에서 같은 닉네임을 사용하는 계정과 연결됩니다.
      </p>

      <button
        type="button"
        className="smallButton petLinkButton"
        onClick={() => void linkMyPetAccount()}
        disabled={petLinkSubmitting}
      >
        {petLinkSubmitting
          ? "연동 중..."
          : "PET 계정 연동"}
      </button>
    </>
  )}
</div>
            <div className="passwordChangeForm">
              <label>
                <span>새 비밀번호</span>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder="6자 이상"
                />
              </label>
              <label>
                <span>새 비밀번호 확인</span>
                <input
                  type="password"
                  value={newPasswordConfirm}
                  onChange={(event) => setNewPasswordConfirm(event.target.value)}
                  placeholder="다시 입력"
                />
              </label>
              <button className="smallButton" onClick={() => void changeMyPassword()} disabled={saving}>
                비밀번호 변경
              </button>
            </div>
          </section>
        </div>
      )}

      {memberDetail && (
        <div className="meetingModalBackdrop" role="presentation">
          <section className="meetingModal memberDetailModal" role="dialog" aria-modal="true">
            <div className="meetingModalHeader">
              <div>
                <span>회원 상세</span>
                <div className="memberDetailNameLine">
                  <h2>{memberDetail.name}</h2>
                  <span className={`memberDetailStatusTag ${!memberDetail.active ? "withdrawn" : warningByMember[memberDetail.id]?.warning ? "warning" : "active"}`}>
                    {!memberDetail.active ? "탈퇴" : warningByMember[memberDetail.id]?.warning ? "경고" : "활동중"}
                  </span>
                </div>
              </div>
              <button
                className="modalCloseButton"
                onClick={() => {
                  setMemberDetailId("");
                  setAdminResetPassword("");
                  setAdminResetPasswordConfirm("");
                  setShowAdminPasswordReset(false);
                }}
              >
                ×
              </button>
            </div>

            <div className="modalSummaryGrid memberDetailSummaryGrid">
              <div><span>입장일</span><strong>{memberDetail.join_date}</strong></div>
              <div><span>생일</span><strong>{memberDetail.birthday ?? "미입력"}</strong></div>
              <div><span>총 참석</span><strong>{memberDetailMeetings.length}회</strong></div>
              <div><span>최근 참석</span><strong>{lastAttendanceByMember[memberDetail.id] ?? "-"}</strong></div>
            </div>
            <div className="memberProfileSnapshot"><div><span>로그인</span><strong>{memberDetailProfile ? "연결됨" : "미가입"}</strong></div><div><span>권한</span><strong>{memberDetailProfile?.role === "owner" ? "제작자" : memberDetailProfile?.role === "admin" ? "관리자" : "회원"}</strong></div><div><span>활동점수</span><strong>{pointsByMember[memberDetail.id]?.exp?.toLocaleString("ko-KR") ?? "-"}</strong></div><div><span>최근 상태</span><strong>{warningByMember[memberDetail.id]?.text ?? "-"}</strong></div></div>

            {isAdmin && (
              <div className="modalSection memberAccountAdminSection">
                <div className="modalSectionHead">
                  <strong>로그인 계정 관리</strong>
                  <span>
                    {memberDetailProfile
                      ? memberDetailProfile.role === "owner"
                        ? "제작자"
                        : memberDetailProfile.role === "admin"
                          ? "관리자"
                          : "회원"
                      : "계정 미연결"}
                  </span>
                </div>

                {!memberDetailProfile ? (
                  <div className="accountAdminHint">
                    이 회원은 아직 최초 가입을 하지 않아 재설정할 로그인 계정이 없습니다.
                  </div>
                ) : currentMember?.id === memberDetail.id ? (
                  <div className="accountAdminHint">
                    본인 비밀번호는 상단 <strong>내 계정</strong>에서 변경해주세요.
                  </div>
                ) : memberDetailProfile.role === "owner" ? (
                  <div className="accountAdminHint">
                    제작자 계정의 비밀번호는 회원 관리 화면에서 재설정할 수 없습니다.
                  </div>
                ) : currentRole === "admin" && memberDetailProfile.role === "admin" ? (
                  <div className="accountAdminHint">
                    관리자는 다른 관리자의 비밀번호를 재설정할 수 없습니다.
                  </div>
                ) : (
                  <div className="adminPasswordResetCompact">
                    <button
                      className="smallButton passwordResetToggleButton"
                      onClick={() => {
                        setShowAdminPasswordReset((current) => !current);
                        setAdminResetPassword("");
                        setAdminResetPasswordConfirm("");
                      }}
                    >
                      {showAdminPasswordReset ? "재설정 취소" : "비밀번호 재설정"}
                    </button>
                    {showAdminPasswordReset && (
                      <div className="adminPasswordResetBox">
                        <div className="adminPasswordResetFields">
                      <label>
                        <span>새 비밀번호</span>
                        <input
                          type="password"
                          autoComplete="new-password"
                          minLength={6}
                          maxLength={72}
                          placeholder="6자 이상"
                          value={adminResetPassword}
                          onChange={(event) => setAdminResetPassword(event.target.value)}
                        />
                      </label>
                      <label>
                        <span>비밀번호 확인</span>
                        <input
                          type="password"
                          autoComplete="new-password"
                          minLength={6}
                          maxLength={72}
                          placeholder="다시 입력"
                          value={adminResetPasswordConfirm}
                          onChange={(event) => setAdminResetPasswordConfirm(event.target.value)}
                        />
                      </label>
                      <button
                        className="tinyButton passwordResetButton"
                        onClick={() => void resetMemberPasswordByAdmin(memberDetail)}
                        disabled={
                          saving ||
                          adminResetPassword.length < 6 ||
                          adminResetPassword !== adminResetPasswordConfirm
                        }
                      >
                        {saving ? "처리 중..." : "비밀번호 재설정"}
                      </button>
                    </div>
                        <small className="passwordResetNotice">
                          기존 비밀번호는 표시하지 않으며 비밀번호 값은 변경 이력에 저장하지 않습니다.
                        </small>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="modalSection memberAttendanceCalendarSection">
              <div className="calendarHeader memberCalendarHeader">
                <div>
                  <strong>참석 달력</strong>
                  <span>벙에 참석한 날짜를 달력으로 확인합니다.</span>
                </div>
                <div className="calendarMonthNav">
                  <button
                    type="button"
                    aria-label="이전 달"
                    onClick={() => setMemberCalendarMonth((month) => shiftMonth(month, -1))}
                  >
                    ‹
                  </button>
                  <strong>{memberCalendarMonth.replace("-", "년 ")}월</strong>
                  <button
                    type="button"
                    aria-label="다음 달"
                    onClick={() => setMemberCalendarMonth((month) => shiftMonth(month, 1))}
                  >
                    ›
                  </button>
                </div>
              </div>

              <div className="calendarWeekdays memberCalendarWeekdays" aria-hidden="true">
                {["일", "월", "화", "수", "목", "금", "토"].map((day) => (
                  <span key={day}>{day}</span>
                ))}
              </div>

              <div className="calendarGrid memberCalendarGrid">
                {memberCalendarCells.map((cell) => {
                  const attended = memberMeetingsByDate.get(cell.date) ?? [];
                  return (
                    <div
                      className={`calendarDay memberCalendarDay ${cell.inMonth ? "" : "outside"} ${attended.length > 0 ? "attended" : ""}`}
                      key={cell.date}
                    >
                      <div className="calendarDayNumber">
                        <span>{cell.day}</span>
                        {attended.length > 0 && <em>{attended.length}</em>}
                      </div>
                      <div className="calendarEvents">
                        {attended.slice(0, 1).map((meeting) => (
                          <button
                            type="button"
                            className="calendarEvent memberAttendanceEvent"
                            key={meeting.id}
                            onClick={() => {
                              setMemberDetailId("");
                              setDetailMeetingId(meeting.id);
                            }}
                            title={meeting.title}
                          >
                            {meeting.title}
                          </button>
                        ))}
                        {attended.length > 1 && (
                          <span className="calendarMoreEvents">+{attended.length - 1}개</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="modalSection">
              <div className="modalSectionHead">
                <strong>최근 참석</strong>
                <span>최대 10건</span>
              </div>
              <div className="myActivityList">
                {memberDetailMeetings.slice(0, 10).map((meeting) => (
                  <button
                    key={meeting.id}
                    onClick={() => {
                      setMemberDetailId("");
                      setDetailMeetingId(meeting.id);
                    }}
                  >
                    <div>
                      <strong>{meeting.title}</strong>
                      <span>{meeting.date}</span>
                    </div>
                    <span>상세</span>
                  </button>
                ))}
                {memberDetailMeetings.length === 0 && <div className="empty">참석 기록이 없습니다.</div>}
              </div>
            </div>
          </section>
        </div>
      )}

      {detailMeeting && (
        <div
          className="meetingModalBackdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setDetailMeetingId("");
          }}
        >
          <section
            className="meetingModal"
            role="dialog"
            aria-modal="true"
            aria-label={`${detailMeeting.title} 모임 상세`}
          >
            <div className="meetingModalHeader">
              <div>
                <span>{detailMeeting.date}</span>
                <h2>{detailMeeting.title}</h2>
              </div>
              <button
                className="modalCloseButton"
                onClick={() => setDetailMeetingId("")}
                aria-label="닫기"
              >
                ×
              </button>
            </div>

            <div className="modalSummaryGrid">
              <div>
                <span>참석 인원</span>
                <strong>
                  {detailMeeting.attendeeIds.length + detailMeeting.guests.length}명
                </strong>
              </div>
              <div>
                <span>총 비용</span>
                <strong>
                  {detailMeeting.cost == null ? "미입력" : won(Number(detailMeeting.cost))}
                </strong>
              </div>
              <div>
                <span>회원</span>
                <strong>{detailMeeting.attendeeIds.length}명</strong>
              </div>
              <div>
                <span>게스트</span>
                <strong>{detailMeeting.guests.length}명</strong>
              </div>
              <div>
                <span>정산 상태</span>
                <strong>{detailMeeting.cost == null ? "비용 입력 필요" : "정산 가능"}</strong>
              </div>
            </div>

            <div className="modalSection">
              <div className="modalSectionHead">
                <strong>참석자</strong>
                <span>{detailMeeting.attendeeIds.length}명</span>
              </div>
              <div className="modalPersonChips">
                {detailMeeting.attendeeIds.map((memberId) => {
                  const member = members.find((item) => item.id === memberId);
                  if (!member) return null;
                  return <span key={memberId}>{member.name}</span>;
                })}
                {detailMeeting.attendeeIds.length === 0 && (
                  <div className="empty">참석 회원이 없습니다.</div>
                )}
              </div>
            </div>

            {detailMeeting.guests.length > 0 && (
              <div className="modalSection">
                <div className="modalSectionHead">
                  <strong>게스트</strong>
                  <span>{detailMeeting.guests.length}명</span>
                </div>
                <div className="modalPersonChips guestModalChips">
                  {detailMeeting.guests.map((guest) => (
                    <span key={guest.id}>{guest.name}</span>
                  ))}
                </div>
              </div>
            )}

            {detailMeeting.cost != null && (
              <div className="modalSection">
                <div className="modalSectionHead">
                  <strong>비용 요약</strong>
                </div>
                <div className="modalAllocationList">
                  {detailMeeting.attendeeIds.map((memberId) => {
                    const member = members.find((item) => item.id === memberId);
                    if (!member) return null;
                    const share =
                      meetingAllocation(detailMeeting).shares[`m:${memberId}`] ?? 0;

                    return (
                      <div key={memberId}>
                        <span>{member.name}</span>
                        <small>벙비</small>
                        <strong>{won(share)}</strong>
                      </div>
                    );
                  })}
                  {detailMeeting.guests.map((guest) => (
                    <div key={guest.id}>
                      <span>{guest.name}</span>
                      <small>게스트</small>
                      <strong>
                        {won(
                          meetingAllocation(detailMeeting).shares[`g:${guest.id}`] ?? 0
                        )}
                      </strong>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="meetingModalFooter">
              <button
                className="tinyButton ghost"
                onClick={() => {
                  setSelectedMonth(detailMeeting.date.slice(0, 7));
                  setSelectedMeetingId(detailMeeting.id);
                  beginMeetingEdit(detailMeeting);
                  setDetailMeetingId("");
                  setMainTab("meetings");
                }}
              >
                수정
              </button>
              <button
                className="tinyButton ghost"
                onClick={() => void copyMeeting(detailMeeting)}
                disabled={saving}
              >
                이 모임 복사
              </button>
              <button
                className="tinyButton dangerText"
                onClick={() => void deleteMeeting(detailMeeting)}
                disabled={saving}
              >
                삭제
              </button>
              <button
                className="smallButton"
                onClick={() => {
                  setSelectedMonth(detailMeeting.date.slice(0, 7));
                  setSelectedMeetingId(detailMeeting.id);
                  setDetailMeetingId("");
                  setMainTab("meetings");
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              >
                모임 관리 열기
              </button>
            </div>
          </section>
        </div>
      )}

</main>
  );
}
