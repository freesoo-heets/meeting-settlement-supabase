import { NextResponse } from "next/server";
import { getServerAdmin } from "../../../../lib/server-admin";

export async function GET() {
  try {
    const admin = getServerAdmin();
    const { data, error } = await admin
      .from("profiles")
      .select("id")
      .eq("role", "owner")
      .limit(1)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { ownerExists: null, error: "초기 운영자 상태를 확인할 수 없습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { ownerExists: Boolean(data) },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch {
    return NextResponse.json(
      { ownerExists: null, error: "초기 운영자 상태를 확인할 수 없습니다." },
      { status: 500 }
    );
  }
}
