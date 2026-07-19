"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const CATEGORY_LABEL: Record<string, string> = {
  general: "일반",
  academic: "학습/성적",
  emotional: "정서/심리",
  career: "진로",
  social: "교우관계",
  other: "기타",
};

const CATEGORY_COLOR: Record<string, string> = {
  general: "#2d6be0",
  academic: "#0e7c46",
  emotional: "#d2447a",
  career: "#6c50c8",
  social: "#a97f24",
  other: "#9aa39d",
};

export function StatsCharts({
  byCategory,
  trend,
}: {
  byCategory: { category: string; count: number }[];
  trend: { month: string; enrollment: number; student: number }[];
}) {
  const pieData = byCategory.map((b) => ({
    name: CATEGORY_LABEL[b.category] ?? b.category,
    value: b.count,
    fill: CATEGORY_COLOR[b.category] ?? "#9aa39d",
  }));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section className="bg-card border-border rounded-md border p-4">
        <header className="mb-2">
          <p className="eyebrow">사유별 분포</p>
          <h2 className="text-foreground mt-1 text-sm font-semibold">학생상담 카테고리</h2>
        </header>
        {pieData.length === 0 ? (
          <p className="text-muted-foreground py-12 text-center text-sm">데이터 없음</p>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  outerRadius={90}
                  label={(entry) => `${entry.name} ${entry.value}`}
                >
                  {pieData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="bg-card border-border rounded-md border p-4">
        <header className="mb-2">
          <p className="eyebrow">월별 추세</p>
          <h2 className="text-foreground mt-1 text-sm font-semibold">상담 건수</h2>
        </header>
        {trend.length === 0 ? (
          <p className="text-muted-foreground py-12 text-center text-sm">데이터 없음</p>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trend} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e3d6" />
                <XAxis dataKey="month" fontSize={11} />
                <YAxis fontSize={11} allowDecimals={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="enrollment" name="등록상담" fill="#0e7c46" />
                <Bar dataKey="student" name="학생상담" fill="#a97f24" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
    </div>
  );
}
