// ─────────────────────────────────────────────
// 테스트용 데이터 (서울 지역 가상의 단지·업체·민원)
// 메모리 저장소 초기화 시 1회 사용됩니다.
// ─────────────────────────────────────────────
import { DISTRICT_NAMES } from "./seoul";
import { selectContractor } from "./services/assignment";
import type { Apartment, Complaint, ComplaintStatus, Contractor, DefectType, Urgency } from "./types";

export const APARTMENTS: Apartment[] = [
  ["한빛센트럴", "강남구", "테헤란로 100"],
  ["푸른숲마을", "송파구", "올림픽로 200"],
  ["새솔타운", "마포구", "월드컵로 50"],
  ["하늘채움", "노원구", "동일로 1400"],
  ["행복드림", "강서구", "공항대로 300"],
  ["누리파크", "관악구", "관악로 150"],
  ["솔빛마을", "은평구", "통일로 800"],
  ["강변리버뷰", "성동구", "왕십리로 120"],
  ["여의파크", "영등포구", "여의대로 60"],
  ["서리풀하임", "서초구", "서초대로 250"],
  ["노들마을", "동작구", "노량진로 40"],
  ["아차뜰", "광진구", "능동로 90"],
  ["디지털힐스", "구로구", "디지털로 30"],
  ["망우숲", "중랑구", "망우로 200"],
  ["이촌하늘", "용산구", "이촌로 70"],
  ["도봉숲채", "도봉구", "도봉로 500"],
  ["고덕그린", "강동구", "고덕로 180"],
  ["가산하이츠", "금천구", "가산디지털로 10"],
  ["인왕마루", "종로구", "사직로 20"],
  ["정릉솔뫼", "성북구", "정릉로 110"],
].map(([name, region, road], i) => ({ id: `apt-${i + 1}`, name, region, address: `서울 ${region} ${road}` }));

/** 서울 25개 자치구 (업체 담당 지역 선택지) */
export const REGIONS = DISTRICT_NAMES;

export function findApartment(name: string): Apartment | undefined {
  const n = name.replace(/\s/g, "");
  if (!n) return undefined;
  return APARTMENTS.find((a) => {
    const an = a.name.replace(/\s/g, "");
    return n.includes(an) || an.includes(n);
  });
}

const iso = (d: Date) => d.toISOString();

export function seedContractors(): Contractor[] {
  const now = iso(new Date());
  const c = (
    id: string,
    name: string,
    defectTypes: DefectType[],
    regions: string[],
    phone: string,
    email: string,
    isContracted = true,
    isAvailable = true,
  ): Contractor => ({ id, name, defectTypes, regions, phone, email, isContracted, isAvailable, createdAt: now });

  return [
    c("ctr-1", "바른배관설비", ["LEAK_PIPE"], ["강남구", "서초구", "송파구", "강동구", "광진구", "성동구"], "02-555-1001", "pipe@barun.test"),
    c("ctr-2", "한결누수탐지", ["LEAK_PIPE", "WALL_FLOOR"], ["마포구", "은평구", "서대문구", "용산구", "종로구", "중구", "노원구", "도봉구", "중랑구", "성북구"], "02-700-2002", "leak@hangyeol.test"),
    c("ctr-3", "밝은전기공사", ["ELECTRIC"], ["강남구", "서초구", "송파구", "동작구", "관악구", "영등포구", "성동구", "광진구"], "02-333-3003", "elec@bright.test"),
    c("ctr-4", "든든창호", ["DOOR_WINDOW"], ["노원구", "도봉구", "강북구", "성북구", "중랑구", "동대문구", "강남구", "송파구", "서초구"], "02-222-4004", "door@dd.test"),
    c("ctr-5", "따숨냉난방", ["HVAC"], ["송파구", "강동구", "광진구", "노원구", "중랑구", "성동구", "강남구", "서초구"], "02-888-5005", "hvac@ttasum.test"),
    c("ctr-6", "튼튼건축보수", ["WALL_FLOOR", "COMMON"], ["강남구", "서초구", "송파구", "성동구", "광진구", "용산구", "강동구"], "02-444-6006", "build@teun.test"),
    c("ctr-7", "종합시설관리㈜", ["COMMON", "ETC", "ELECTRIC"], ["노원구", "도봉구", "성북구", "중랑구", "은평구", "마포구", "종로구", "용산구"], "02-111-7007", "fm@jonghap.test"),
    c("ctr-8", "신속배관(미계약)", ["LEAK_PIPE"], ["구로구", "금천구", "강서구", "양천구", "관악구"], "02-999-8008", "fast@pipe.test", false, true),
    c("ctr-9", "서남냉난방", ["HVAC"], ["영등포구", "구로구", "금천구", "관악구", "동작구", "강서구"], "02-777-9009", "hvac@seonam.test", true, false),
    c("ctr-10", "서부종합설비", ["ELECTRIC", "DOOR_WINDOW", "ETC", "COMMON"], ["강서구", "양천구", "영등포구", "구로구", "마포구", "동작구"], "02-666-1010", "west@seobu.test"),
  ];
}

// ── 민원 시드 ──────────────────────────────────

const DESCRIPTIONS: Record<DefectType, string[]> = {
  LEAK_PIPE: [
    "욕실 천장에서 물이 계속 떨어집니다. 윗집 배관 문제로 보입니다.",
    "주방 싱크대 하부 배관에서 누수가 발생합니다.",
    "세탁실 배수구가 역류하여 바닥에 물이 고입니다.",
  ],
  ELECTRIC: [
    "거실 조명과 주방 콘센트 전원이 동시에 나갔습니다.",
    "안방 스위치를 켜면 차단기가 내려갑니다.",
    "현관 센서등이 계속 켜져 있습니다.",
  ],
  DOOR_WINDOW: [
    "베란다 창문이 잘 닫히지 않고 틈으로 바람이 들어옵니다.",
    "현관문 도어클로저가 고장 나 문이 세게 닫힙니다.",
    "작은방 방충망 레일이 휘었습니다.",
  ],
  HVAC: [
    "보일러 작동 시 난방이 되지 않고 에러코드가 표시됩니다.",
    "작은방 바닥 난방만 미지근합니다.",
    "온수가 나오다가 갑자기 찬물로 바뀝니다.",
  ],
  WALL_FLOOR: [
    "거실 마루가 들뜨고 일부 균열이 생겼습니다.",
    "안방 벽에 결로와 곰팡이가 생겼습니다.",
    "욕실 바닥 타일이 깨졌습니다.",
  ],
  COMMON: [
    "지하주차장 조명 여러 개가 깜빡거립니다.",
    "동 출입구 공동현관문이 잘 열리지 않습니다.",
    "복도 계단 난간이 흔들립니다.",
  ],
  ETC: ["현관 도어락 배터리 교체 후에도 경고음이 납니다.", "베란다 빨래 건조대가 내려오지 않습니다."],
};

const NAMES = ["김민수", "이서연", "박지훈", "최유진", "정하늘", "강도윤", "윤서아", "임재현", "한소희", "오준영", "신지민", "장예린", "조현우", "백나래", "서동현", "권수빈", "황보람", "문태호", "송가은", "류승민"];
const TYPES: DefectType[] = ["LEAK_PIPE", "ELECTRIC", "DOOR_WINDOW", "HVAC", "WALL_FLOOR", "COMMON", "LEAK_PIPE", "ETC"];

/** 자치구별 [처리 완료, 작업 중, 작업 예정, 업체 배정, 접수 대기] 건수 */
const DISTRICT_MIX: Record<string, [number, number, number, number, number]> = {
  강남구: [5, 1, 0, 1, 0],
  송파구: [3, 1, 1, 0, 0],
  마포구: [1, 1, 0, 1, 1],
  노원구: [3, 0, 0, 0, 0],
  강서구: [1, 0, 0, 1, 2],
  관악구: [0, 1, 0, 0, 2],
  은평구: [1, 0, 1, 0, 0],
  성동구: [2, 1, 0, 0, 0],
  영등포구: [2, 0, 1, 1, 0],
  서초구: [2, 0, 0, 0, 1],
  동작구: [1, 1, 0, 0, 0],
  광진구: [2, 0, 0, 0, 0],
  구로구: [1, 0, 0, 1, 1],
  중랑구: [0, 1, 0, 1, 0],
  용산구: [1, 0, 1, 0, 0],
  도봉구: [1, 0, 0, 0, 0],
  강동구: [1, 1, 0, 1, 0],
  금천구: [0, 0, 0, 1, 2],
  종로구: [0, 1, 0, 0, 0],
  성북구: [1, 0, 0, 1, 0],
};

const FLOW: ComplaintStatus[] = ["RECEIVED", "ASSIGNED", "SCHEDULED", "IN_PROGRESS", "COMPLETED"];
const MIX_STATUS: ComplaintStatus[] = ["COMPLETED", "IN_PROGRESS", "SCHEDULED", "ASSIGNED", "PENDING_REVIEW"];
const HOURS: Record<string, [number, number]> = {
  COMPLETED: [48, 400],
  IN_PROGRESS: [20, 90],
  SCHEDULED: [10, 60],
  ASSIGNED: [3, 30],
  PENDING_REVIEW: [1, 20],
};

export function seedComplaints(contractors: Contractor[] = seedContractors()): Complaint[] {
  const now = Date.now();
  const ymd = new Date(now).toISOString().slice(0, 10).replace(/-/g, "");
  const rows: Omit<Complaint, "receiptNo">[] = [];
  let n = 0;

  for (const apt of APARTMENTS) {
    const mix = DISTRICT_MIX[apt.region];
    if (!mix) continue;
    mix.forEach((count, mi) => {
      for (let k = 0; k < count; k++, n++) {
        const status = MIX_STATUS[mi];
        const type = TYPES[(n * 3 + k) % TYPES.length];
        const [lo, hi] = HOURS[status];
        const hoursAgo = lo + ((n * 37) % (hi - lo));
        const receivedAt = new Date(now - hoursAgo * 3600_000);
        const urgency: Urgency = (["NORMAL", "HIGH", "NORMAL", "LOW", "EMERGENCY", "NORMAL"] as Urgency[])[n % 6];

        let contractorId: string | null = null;
        const history: Complaint["history"] = [{ at: iso(receivedAt), status: "RECEIVED", note: "AI 전화 접수", actor: "AI" }];
        if (status === "PENDING_REVIEW") {
          const r = selectContractor(type, apt.region, contractors, {});
          history.push({ at: iso(new Date(receivedAt.getTime() + 60_000)), status, note: r.contractor ? "업체 업무 불가로 관리자 확인 대기" : r.reason, actor: "SYSTEM" });
        } else {
          // 시드 데이터는 조건이 맞는 업체, 없으면 같은 분야 업체 중 첫 번째로 배정
          contractorId =
            selectContractor(type, apt.region, contractors, {}).contractor?.id ??
            contractors.find((c) => c.defectTypes.includes(type) && c.isContracted)?.id ??
            null;
          const upto = FLOW.indexOf(status);
          const step = Math.max(1, Math.floor((hoursAgo * 60) / (upto + 1))) * 60_000;
          for (let s = 1; s <= upto; s++) {
            history.push({ at: iso(new Date(receivedAt.getTime() + s * step)), status: FLOW[s], note: s === 1 ? "자동 배정 및 업체 전달" : "상태 변경", actor: s === 1 ? "SYSTEM" : "ADMIN" });
          }
        }

        const descs = DESCRIPTIONS[type];
        const name = NAMES[n % NAMES.length];
        rows.push({
          id: `seed-${n + 1}`,
          receivedAt: iso(receivedAt),
          complainantName: name,
          phone: `010-${String(2000 + ((n * 731) % 7000)).padStart(4, "0")}-${String(1000 + ((n * 977) % 9000)).padStart(4, "0")}`,
          apartmentName: apt.name,
          region: apt.region,
          building: String(101 + (n % 9)),
          unit: String((2 + (n % 18)) * 100 + 1 + (n % 4)),
          defectType: type,
          description: descs[n % descs.length],
          urgency,
          photos: [],
          contractorId,
          status,
          channel: "PHONE_AI",
          callTranscript: null,
          aiSummary: descs[n % descs.length],
          history,
          updatedAt: history[history.length - 1].at,
        });
      }
    });
  }

  return rows
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
    .map((r, i) => ({ ...r, receiptNo: `MW-${ymd}-${String(i + 1).padStart(4, "0")}` }));
}

/** 통화 시뮬레이터용 예시 통화 스크립트 */
export const SAMPLE_CALLS: { title: string; transcript: string }[] = [
  {
    title: "욕실 누수 (긴급)",
    transcript: `상담원: 안녕하세요, 하자보수 접수센터입니다. 무엇을 도와드릴까요?
민원인: 네, 저는 한빛센트럴 101동 1502호에 사는 홍길동인데요. 지금 욕실 천장에서 물이 뚝뚝 떨어지고 있어요. 계속 쏟아져서 바닥이 다 젖었어요.
상담원: 많이 불편하시겠습니다. 연락 가능한 번호 알려주시겠어요?
민원인: 010-1234-5678이요. 빨리 좀 와주세요.`,
  },
  {
    title: "현관문 고장",
    transcript: `상담원: 하자보수 접수센터입니다.
민원인: 안녕하세요. 하늘채움 아파트 105동 302호 김영희입니다. 현관문 도어 손잡이가 헐거워져서 문이 잘 안 닫혀요.
상담원: 연락처 부탁드립니다.
민원인: 010-9876-5432입니다. 급하진 않은데 이번 주 안에 봐주시면 좋겠어요.`,
  },
  {
    title: "난방 불량",
    transcript: `상담원: 네, 접수센터입니다.
민원인: 푸른숲마을 207동 801호인데요, 이름은 박철수예요. 어제부터 보일러가 안 돌아가서 난방이 하나도 안 돼요. 아이가 있어서 너무 추워요.
상담원: 전화번호는요?
민원인: 공일공 오오오오 일이삼사, 아니 010-5555-1234요.`,
  },
  {
    title: "띄어쓰기 불규칙 (음성인식)",
    transcript: `상담원: 하자보수 접수센터입니다.
민원인: 네 저는 하늘채움 1 0 5 동 3 02 호 사는 김 영 희 입니다. 현관문 손잡이가 헐거워서 문이 잘 안 닫혀요.
상담원: 연락처 부탁드립니다.
민원인: 공일공 구팔칠육 오사삼이 요`,
  },
  {
    title: "배정 불가 사례 (금천구 누수)",
    transcript: `상담원: 접수센터입니다.
민원인: 가산하이츠 110동 1201호 최민지입니다. 주방 싱크대 밑 배관에서 물이 새요.
상담원: 연락처 알려주세요.
민원인: 010-2222-3333입니다.`,
  },
];
