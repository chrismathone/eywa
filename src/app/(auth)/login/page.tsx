import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "./login-form";

export const metadata = { title: "로그인 — eywa" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="space-y-2 text-center">
        <CardTitle className="text-2xl">eywa</CardTitle>
        <CardDescription>인재원 학원관리 — 데모 환경</CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm next={next} />
      </CardContent>
    </Card>
  );
}
