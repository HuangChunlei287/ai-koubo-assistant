"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
import { Button } from "@heroui/react";
import { useEffect, useState } from "react";
import { Globe, Home, Monitor, Moon, Settings, Sun } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export function Navbar() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const { locale, setLocale, t } = useI18n();

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const nextTheme = () => {
    const order = ["system", "light", "dark"] as const;
    const cur = (theme ?? "system") as (typeof order)[number];
    const i = order.indexOf(cur);
    setTheme(order[(i + 1) % order.length]);
  };

  const toggleLocale = () => setLocale(locale === "zh" ? "en" : "zh");

  return (
    <header className="sticky top-0 z-30 border-b border-default-200 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="inline-block size-2 rounded-full bg-primary" />
          AI 口播创作助手
        </Link>
        <nav className="flex items-center gap-2">
          <Link href="/">
            <Button variant="ghost" size="sm" isIconOnly aria-label="Home">
              <Home className="size-4" />
            </Button>
          </Link>
          <Link href="/settings">
            <Button variant="ghost" size="sm" isIconOnly aria-label="Settings">
              <Settings className="size-4" />
            </Button>
          </Link>
          <Button variant="ghost" size="sm" isIconOnly onPress={nextTheme} aria-label="toggle theme">
            {mounted
              ? theme === "system"
                ? <Monitor className="size-4" />
                : resolvedTheme === "dark"
                  ? <Moon className="size-4" />
                  : <Sun className="size-4" />
              : <Monitor className="size-4" />}
          </Button>
          <Button variant="ghost" size="sm" onPress={toggleLocale} aria-label="toggle language" className="gap-1.5">
            <Globe className="size-4" />{t.navLangToggle}
          </Button>
        </nav>
      </div>
    </header>
  );
}

