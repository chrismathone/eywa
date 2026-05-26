function getGreeting(hour: number) {
  if (hour < 6) return "이른 시간이네요";
  if (hour < 12) return "좋은 아침입니다";
  if (hour < 18) return "오늘도 수고가 많으세요";
  return "고생하셨습니다";
}

function getWeekOfYear(date: Date) {
  const start = new Date(date.getFullYear(), 0, 1);
  const days = Math.floor((date.getTime() - start.getTime()) / 86_400_000);
  return Math.ceil((days + start.getDay() + 1) / 7);
}

const KO_DATE = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "long",
});

export function DashboardHero({ name }: { name: string }) {
  const today = new Date();
  const dateString = KO_DATE.format(today);
  const week = getWeekOfYear(today);
  const semester = today.getMonth() >= 6 ? "2학기" : "1학기";
  const greeting = getGreeting(today.getHours());

  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1.5">
        <p className="eyebrow">{dateString}</p>
        <h1 className="display text-foreground text-3xl sm:text-[2.5rem]">
          {greeting}, <span className="text-muted-foreground">{name}</span>.
        </h1>
      </div>

      <div className="border-border bg-card flex items-center gap-5 rounded-md border px-4 py-2.5">
        <Stat label="학기" value={semester} />
        <Divider />
        <Stat label="주차" value={`${week}주`} />
        <Divider />
        <Stat label="재원생" value="248" unit="명" />
      </div>
    </header>
  );
}

function Divider() {
  return <span className="bg-border h-7 w-px" aria-hidden />;
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="space-y-0.5">
      <p className="eyebrow">{label}</p>
      <p className="num text-foreground text-sm font-semibold">
        {value}
        {unit ? (
          <span className="text-muted-foreground ml-0.5 text-xs font-normal">{unit}</span>
        ) : null}
      </p>
    </div>
  );
}
