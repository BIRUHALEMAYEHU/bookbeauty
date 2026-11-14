import { ClientText } from "@/i18n/client-text";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <ClientText sections={["auth"]}>{children}</ClientText>;
}
