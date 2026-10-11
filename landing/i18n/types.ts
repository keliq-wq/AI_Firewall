export type Locale = "en" | "zh";

export interface Dict {
  meta: {
    title: string;
    description: string;
  };
  nav: {
    layers: string;
    evidence: string;
    quickstart: string;
    github: string;
  };
  hero: {
    headline: string;
    sub: string;
    ctaPrimary: string;
    ctaSecondary: string;
    installLabel: string;
    installCommand: string;
    register: {
      label: string;
      cluster: string;
      cols: [string, string, string, string, string];
      fromLabel: string;
      from: string;
      declared: string;
      actual: string;
      verdict: string;
      reason: string;
      sigLabel: string;
      sig: string;
      sigHref: string;
      signed: string;
      seeOnChain: string;
    };
  };
  layers: {
    title: string;
    sub: string;
    items: Array<{
      name: string;
      role: string;
      body: string;
      evidence: string;
    }>;
  };
  evidence: {
    title: string;
    sub: string;
    cols: { code: string; attempt: string; cluster: string; signature: string };
    rows: Array<{
      code: string;
      attempt: string;
      cluster: string;
      sig: string;
      href: string;
      status: "blocked" | "passed";
    }>;
    statusBlocked: string;
    statusPassed: string;
    note: string;
  };
  quickstart: {
    title: string;
    sub: string;
    steps: Array<{ title: string; body: string; command: string }>;
    mcpTitle: string;
    mcpBody: string;
    mcpCode: string;
    dashboardTitle: string;
    dashboardBody: string;
    dashboardCode: string;
  };
  finalCta: {
    title: string;
    sub: string;
    button: string;
  };
  footer: {
    license: string;
    builtFor: string;
  };
  langLabel: string;
}
