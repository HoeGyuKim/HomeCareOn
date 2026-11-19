// ─────────────────────────────────────────────
// 서울특별시 25개 자치구
// col/row: 대시보드 타일 지도에서의 위치 (실제 지리 배치를 6×6 격자로 단순화)
// ─────────────────────────────────────────────
export interface District {
  name: string;
  col: number;
  row: number;
}

export const SEOUL_DISTRICTS: District[] = [
  { name: "강북구", col: 3, row: 0 },
  { name: "도봉구", col: 4, row: 0 },
  { name: "노원구", col: 5, row: 0 },
  { name: "은평구", col: 1, row: 1 },
  { name: "종로구", col: 2, row: 1 },
  { name: "성북구", col: 3, row: 1 },
  { name: "동대문구", col: 4, row: 1 },
  { name: "중랑구", col: 5, row: 1 },
  { name: "서대문구", col: 1, row: 2 },
  { name: "중구", col: 2, row: 2 },
  { name: "성동구", col: 3, row: 2 },
  { name: "광진구", col: 4, row: 2 },
  { name: "강동구", col: 5, row: 2 },
  { name: "강서구", col: 0, row: 3 },
  { name: "마포구", col: 1, row: 3 },
  { name: "용산구", col: 2, row: 3 },
  { name: "서초구", col: 3, row: 3 },
  { name: "강남구", col: 4, row: 3 },
  { name: "송파구", col: 5, row: 3 },
  { name: "양천구", col: 0, row: 4 },
  { name: "영등포구", col: 1, row: 4 },
  { name: "동작구", col: 2, row: 4 },
  { name: "구로구", col: 0, row: 5 },
  { name: "금천구", col: 1, row: 5 },
  { name: "관악구", col: 2, row: 5 },
];

export const DISTRICT_NAMES = SEOUL_DISTRICTS.map((d) => d.name);
