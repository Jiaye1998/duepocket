import {
  Activity,
  Bell,
  Bot,
  CalendarPlus,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  Database,
  Download,
  Edit3,
  FileJson,
  Gauge,
  Image as ImageIcon,
  Import,
  Lock,
  Plus,
  Radar,
  RefreshCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wallet,
  XCircle,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { parseRenewalText, runLocalOcr } from "./lib/aiParser";
import {
  deleteItem as deleteItemFromDb,
  ensureDemoData,
  listCandidates,
  listItems,
  replaceCandidates,
  replaceItems,
  resetDemoData,
  saveCandidate,
  saveItem,
  updateCandidateStatus,
} from "./lib/db";
import { addCycle, addDays, buildRadarEvents, formatDate, humanDistance } from "./lib/date";
import { runEvaluation } from "./lib/evaluate";
import { buildIcs, createBackup, downloadText, formatMoney, parseBackup } from "./lib/exporters";
import { createId } from "./lib/id";
import { buildMonthlyReport, type CurrencyTotals } from "./lib/report";
import type { AIExtractionCandidate, BillingCycle, CurrencyCode, RecordType, RenewalDraft, RenewalItem } from "./types";

type ViewKey = "radar" | "ai" | "ledger" | "report";

const viewItems: Array<{ key: ViewKey; label: string; icon: typeof Radar }> = [
  { key: "radar", label: "30-day radar", icon: Radar },
  { key: "ai", label: "AI intake", icon: Bot },
  { key: "ledger", label: "Local ledger", icon: Database },
  { key: "report", label: "Report", icon: Activity },
];

const currencies: CurrencyCode[] = ["USD", "SGD", "CNY", "HKD", "EUR", "GBP", "JPY"];
const cycles: BillingCycle[] = ["monthly", "yearly", "quarterly", "weekly", "one_time", "top_up"];
const categories = ["AI tools", "Trial", "Media", "Transport", "App wallet", "Work tools", "Cloud", "Creative", "Subscription"];

function App() {
  const [view, setView] = useState<ViewKey>(() => {
    const param = new URLSearchParams(window.location.search).get("view");
    return viewItems.some((item) => item.key === param) ? (param as ViewKey) : "radar";
  });
  const [items, setItems] = useState<RenewalItem[]>([]);
  const [candidates, setCandidates] = useState<AIExtractionCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingItem, setEditingItem] = useState<RenewalItem | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [toast, setToast] = useState("");

  const refresh = useCallback(async () => {
    const [nextItems, nextCandidates] = await Promise.all([listItems(), listCandidates()]);
    setItems(nextItems);
    setCandidates(nextCandidates);
  }, []);

  useEffect(() => {
    ensureDemoData()
      .then(refresh)
      .finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    const handleOnline = () => setOnline(navigator.onLine);
    const handleInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOnline);
    window.addEventListener("beforeinstallprompt", handleInstall);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOnline);
      window.removeEventListener("beforeinstallprompt", handleInstall);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const showToast = useCallback((message: string) => setToast(message), []);

  const handleViewChange = (nextView: ViewKey) => {
    setView(nextView);
    const url = new URL(window.location.href);
    url.searchParams.set("view", nextView);
    window.history.replaceState(null, "", url);
  };

  const handleSaveDraft = async (draft: RenewalDraft, source: RenewalItem["source"], existing?: RenewalItem | null) => {
    await saveItem(draftToItem(draft, source, existing || undefined));
    setEditingItem(null);
    await refresh();
    showToast(existing ? "Item updated" : "Item saved");
  };

  const handleDeleteItem = async (item: RenewalItem) => {
    await deleteItemFromDb(item.id);
    await refresh();
    showToast(`${item.serviceName} removed`);
  };

  const handleRenewItem = async (item: RenewalItem) => {
    await saveItem({
      ...item,
      nextChargeDate: item.cycle === "one_time" || item.cycle === "top_up" ? addDays(new Date(), 30) : addCycle(item.nextChargeDate, item.cycle),
      status: "active",
      lastReviewedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await refresh();
    showToast("Moved to next cycle");
  };

  const handleReviewed = async (item: RenewalItem) => {
    await saveItem({
      ...item,
      status: "active",
      lastReviewedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await refresh();
    showToast("Marked reviewed");
  };

  const handleCreateCandidate = async (candidate: AIExtractionCandidate) => {
    await saveCandidate(candidate);
    await refresh();
    showToast("Candidate ready for confirmation");
  };

  const handleConfirmCandidate = async (candidate: AIExtractionCandidate, draft: RenewalDraft) => {
    await saveItem(draftToItem(draft, candidate.source === "screenshot" ? "ocr" : "ai-text"));
    await updateCandidateStatus(candidate.id, "confirmed");
    await refresh();
    showToast("Candidate confirmed and saved");
  };

  const handleRejectCandidate = async (candidate: AIExtractionCandidate) => {
    await updateCandidateStatus(candidate.id, "rejected");
    await refresh();
    showToast("Candidate rejected");
  };

  const handleResetDemo = async () => {
    if (!window.confirm("Reset all local records to the demo dataset? This will replace the current ledger.")) return;
    await resetDemoData();
    setEditingItem(null);
    await refresh();
    showToast("Demo data reset");
  };

  const handleInstall = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  const handleExportBackup = () => {
    downloadText("duepocket-backup.json", JSON.stringify(createBackup(items, candidates), null, 2), "application/json;charset=utf-8");
  };

  const handleImportBackup = async (file: File) => {
    if (!window.confirm("Importing this backup will replace all local records and AI candidates. Continue?")) return;
    const text = await file.text();
    const payload = parseBackup(text);
    await replaceItems(payload.items);
    await replaceCandidates(payload.candidates || []);
    await refresh();
    showToast("Backup restored");
  };

  const handleExportIcs = () => {
    downloadText("duepocket-renewals.ics", buildIcs(items), "text/calendar;charset=utf-8");
  };

  const renderContent = () => {
    if (loading) return <LoadingState />;
    if (view === "radar") {
      return (
        <RadarView
          items={items}
          candidates={candidates}
          editingItem={editingItem}
          onSaveDraft={handleSaveDraft}
          onEdit={setEditingItem}
          onCancelEdit={() => setEditingItem(null)}
          onDelete={handleDeleteItem}
          onRenew={handleRenewItem}
          onReviewed={handleReviewed}
          onResetDemo={handleResetDemo}
          onExportIcs={handleExportIcs}
        />
      );
    }
    if (view === "ai") {
      return (
        <AIView
          candidates={candidates}
          onCreateCandidate={handleCreateCandidate}
          onConfirm={handleConfirmCandidate}
          onReject={handleRejectCandidate}
        />
      );
    }
    if (view === "ledger") {
      return (
        <LedgerView
          items={items}
          onEdit={(item) => {
            setEditingItem(item);
            handleViewChange("radar");
          }}
          onDelete={handleDeleteItem}
          onRenew={handleRenewItem}
          onReviewed={handleReviewed}
          onExportBackup={handleExportBackup}
          onImportBackup={handleImportBackup}
        />
      );
    }
    return <ReportView items={items} candidates={candidates} onExportIcs={handleExportIcs} onExportBackup={handleExportBackup} />;
  };

  const content = renderContent();

  return (
    <div className="min-h-screen">
      <div className="mx-auto flex w-full max-w-[1500px] gap-4 p-3 md:p-5">
        <aside className="sticky top-5 hidden h-[calc(100vh-40px)] w-64 shrink-0 rounded-app border border-slate-200 bg-white p-3 shadow-app lg:block">
          <BrandBlock />
          <nav className="mt-7 grid gap-1" aria-label="Main navigation">
            {viewItems.map((item) => (
              <NavButton key={item.key} item={item} active={view === item.key} onClick={() => handleViewChange(item.key)} />
            ))}
          </nav>
          <div className="mt-auto grid gap-3 pt-8">
            <PrivacyPromise />
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 mb-4 rounded-app border border-slate-200 bg-white/90 p-3 shadow-sm backdrop-blur md:p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 lg:hidden">
                <img className="h-11 w-11 rounded-app" src="./assets/icon.svg" alt="" />
                <div>
                  <p className="text-xs font-black uppercase text-radar-green">防扣费雷达</p>
                  <h1 className="text-lg font-black text-slate-950">DuePocket</h1>
                </div>
              </div>
              <div className="hidden lg:block">
                <p className="eyebrow">AI-powered local-first radar</p>
                <h1 className="text-2xl font-black text-slate-950">DuePocket / 防扣费雷达</h1>
              </div>
              <div className="flex items-center gap-2">
                <span className={`status-pill ${online ? "bg-radar-greenSoft text-radar-green" : "bg-radar-amberSoft text-radar-amber"}`}>
                  {online ? "Online" : "Offline"}
                </span>
                {installPrompt ? (
                  <button className="button button-primary" type="button" onClick={handleInstall}>
                    <Download size={18} />
                    Install
                  </button>
                ) : null}
              </div>
            </div>
            <nav className="mt-3 grid grid-cols-4 gap-1 rounded-app bg-slate-100 p-1 lg:hidden" aria-label="Mobile navigation">
              {viewItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.key}
                    className={`tab-button ${view === item.key ? "tab-button-active" : ""}`}
                    type="button"
                    onClick={() => handleViewChange(item.key)}
                    aria-label={item.label}
                  >
                    <Icon className="mx-auto" size={18} />
                  </button>
                );
              })}
            </nav>
          </header>
          {content}
        </div>
      </div>
      <div
        className={`fixed bottom-4 right-4 z-50 max-w-[calc(100vw-32px)] rounded-app bg-slate-950 px-4 py-3 text-sm font-black text-white shadow-app transition ${
          toast ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"
        }`}
        role="status"
        aria-live="polite"
      >
        {toast}
      </div>
    </div>
  );
}

function BrandBlock() {
  return (
    <div className="flex items-center gap-3">
      <img className="h-12 w-12 rounded-app shadow-app" src="./assets/icon.svg" alt="" />
      <div className="min-w-0">
        <p className="text-xs font-black uppercase text-radar-green">防扣费雷达</p>
        <strong className="block truncate text-lg font-black text-slate-950">DuePocket</strong>
      </div>
    </div>
  );
}

function NavButton({
  item,
  active,
  onClick,
}: {
  item: { key: ViewKey; label: string; icon: typeof Radar };
  active: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button className={`nav-button ${active ? "nav-button-active" : ""}`} type="button" onClick={onClick}>
      <Icon size={19} />
      <span>{item.label}</span>
    </button>
  );
}

function PrivacyPromise() {
  return (
    <div className="rounded-app border border-emerald-100 bg-radar-greenSoft p-3 text-sm text-emerald-950">
      <div className="flex items-center gap-2 font-black">
        <ShieldCheck size={18} />
        Local-first
      </div>
      <p className="mt-2 text-xs font-semibold leading-5 text-emerald-900">
        No account, no bank sync, no default image upload. AI candidates require confirmation.
      </p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="panel grid min-h-[420px] place-items-center">
      <div className="text-center">
        <RefreshCcw className="mx-auto animate-spin text-radar-green" size={30} />
        <p className="mt-3 font-black text-slate-950">Loading local pocket</p>
      </div>
    </div>
  );
}

function RadarView({
  items,
  candidates,
  editingItem,
  onSaveDraft,
  onEdit,
  onCancelEdit,
  onDelete,
  onRenew,
  onReviewed,
  onResetDemo,
  onExportIcs,
}: {
  items: RenewalItem[];
  candidates: AIExtractionCandidate[];
  editingItem: RenewalItem | null;
  onSaveDraft: (draft: RenewalDraft, source: RenewalItem["source"], existing?: RenewalItem | null) => Promise<void>;
  onEdit: (item: RenewalItem) => void;
  onCancelEdit: () => void;
  onDelete: (item: RenewalItem) => void;
  onRenew: (item: RenewalItem) => void;
  onReviewed: (item: RenewalItem) => void;
  onResetDemo: () => void;
  onExportIcs: () => void;
}) {
  const events = buildRadarEvents(items, 30);
  const report = buildMonthlyReport(items, candidates);
  const urgent = events.filter((event) => event.risk === "overdue" || event.risk === "today" || event.risk === "soon");

  return (
    <div className="grid gap-4">
      <section className="grid gap-4 rounded-app border border-slate-200 bg-white p-4 shadow-app lg:grid-cols-[minmax(0,1fr)_330px] lg:p-6">
        <div className="min-w-0">
          <p className="eyebrow">Next 30 days</p>
          <h2 className="text-3xl font-black leading-tight text-slate-950 md:text-4xl">Renewal and app-wallet radar</h2>
          <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-slate-600">
            {urgent.length
              ? `${urgent.length} ${pluralize("item", urgent.length)} ${urgent.length === 1 ? "needs" : "need"} attention before the next charge or low-balance event.`
              : "No urgent renewal or wallet event in the next 7 days."}
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard icon={Gauge} label="Radar events" value={String(events.length)} tone="green" />
            <MetricCard icon={Bell} label="Urgent" value={String(urgent.length)} tone="amber" />
            <MetricCard icon={CircleDollarSign} label="Monthly run-rate" value={formatCurrencyTotals(report.monthlyRunRateByCurrency)} tone="blue" />
            <MetricCard icon={Sparkles} label="AI pending" value={String(report.aiPending)} tone="violet" />
          </div>
        </div>
        <img className="h-full max-h-64 w-full object-contain lg:max-h-none" src="./assets/pocket-illustration.svg" alt="DuePocket radar visual" />
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
        <section className="panel min-w-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Radar queue</p>
              <h2 className="text-xl font-black text-slate-950">Upcoming charges and balances</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="button" type="button" onClick={onExportIcs}>
                <CalendarPlus size={17} />
                Export .ics
              </button>
              <button className="button" type="button" onClick={onResetDemo}>
                <RefreshCcw size={17} />
                Reset demo
              </button>
            </div>
          </div>
          <div className="grid gap-3">
            {events.length ? (
              events.map((event) => (
                <RadarEventCard
                  key={event.id}
                  event={event}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onRenew={onRenew}
                  onReviewed={onReviewed}
                />
              ))
            ) : (
              <EmptyState title="No radar events" body="The next 30 days are clear." />
            )}
          </div>
        </section>

        <ItemForm
          key={editingItem?.id || "new-item"}
          initialItem={editingItem}
          onSave={(draft) => onSaveDraft(draft, editingItem?.source || "manual", editingItem)}
          onCancel={editingItem ? onCancelEdit : undefined}
        />
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Gauge;
  label: string;
  value: string;
  tone: "green" | "blue" | "amber" | "coral" | "violet";
}) {
  const tones = {
    green: "bg-radar-greenSoft text-radar-green",
    blue: "bg-radar-blueSoft text-radar-blue",
    amber: "bg-radar-amberSoft text-radar-amber",
    coral: "bg-radar-coralSoft text-radar-coral",
    violet: "bg-radar-violetSoft text-radar-violet",
  };
  return (
    <article className="metric">
      <span className={`metric-icon ${tones[tone]}`}>
        <Icon size={21} />
      </span>
      <div className="min-w-0">
        <strong className="block truncate text-lg font-black text-slate-950">{value}</strong>
        <span className="text-xs font-bold text-slate-500">{label}</span>
      </div>
    </article>
  );
}

function RadarEventCard({
  event,
  onEdit,
  onDelete,
  onRenew,
  onReviewed,
}: {
  event: ReturnType<typeof buildRadarEvents>[number];
  onEdit: (item: RenewalItem) => void;
  onDelete: (item: RenewalItem) => void;
  onRenew: (item: RenewalItem) => void;
  onReviewed: (item: RenewalItem) => void;
}) {
  const tone = {
    overdue: "border-l-red-500",
    today: "border-l-radar-amber",
    soon: "border-l-radar-amber",
    upcoming: "border-l-radar-blue",
    clear: "border-l-radar-green",
  }[event.risk];
  const badge = {
    overdue: "bg-red-50 text-red-700",
    today: "bg-radar-amberSoft text-radar-amber",
    soon: "bg-radar-amberSoft text-radar-amber",
    upcoming: "bg-radar-blueSoft text-radar-blue",
    clear: "bg-radar-greenSoft text-radar-green",
  }[event.risk];
  return (
    <article className={`grid gap-3 rounded-app border border-l-4 border-slate-200 bg-white p-3 sm:grid-cols-[64px_minmax(0,1fr)_auto] ${tone}`}>
      <div className="grid h-16 w-16 place-items-center rounded-app bg-slate-100 text-center">
        <span>
          <strong className="block text-xl font-black text-slate-950">{formatDate(event.eventDate, { day: "numeric" })}</strong>
          <span className="block text-xs font-black uppercase text-slate-500">{formatDate(event.eventDate, { month: "short" })}</span>
        </span>
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-base font-black text-slate-950">{event.item.serviceName}</h3>
          <span className={`status-pill ${badge}`}>{event.label}</span>
          <span className="status-pill bg-slate-100 text-slate-600">{humanDistance(event.daysAway)}</span>
        </div>
        <p className="mt-2 truncate text-sm font-semibold text-slate-600">
          {event.item.type} · {event.item.category} ·{" "}
          {event.item.type === "appWallet"
            ? `balance ${formatMoney(event.item.walletBalance || 0, event.item.currency)}`
            : `${formatMoney(event.item.amount, event.item.currency)} ${event.item.cycle}`}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <button className="icon-button" type="button" onClick={() => onReviewed(event.item)} aria-label="Mark reviewed" title="Mark reviewed">
          <CheckCircle2 size={18} />
        </button>
        <button className="icon-button" type="button" onClick={() => onRenew(event.item)} aria-label="Move to next cycle" title="Move to next cycle">
          <RefreshCcw size={18} />
        </button>
        <button className="icon-button" type="button" onClick={() => onEdit(event.item)} aria-label="Edit item" title="Edit item">
          <Edit3 size={18} />
        </button>
        <button className="icon-button" type="button" onClick={() => onDelete(event.item)} aria-label="Delete item" title="Delete item">
          <Trash2 size={18} />
        </button>
      </div>
    </article>
  );
}

function ItemForm({
  initialItem,
  onSave,
  onCancel,
}: {
  initialItem?: RenewalItem | null;
  onSave: (draft: RenewalDraft) => void;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState<RenewalDraft>(() => (initialItem ? itemToDraft(initialItem) : emptyDraft()));

  const setValue = <K extends keyof RenewalDraft>(key: K, value: RenewalDraft[K]) => {
    setDraft((current) => normalizeDraft({ ...current, [key]: value }));
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSave(normalizeDraft(draft));
    if (!initialItem) setDraft(emptyDraft());
  };

  return (
    <section className="panel">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Template</p>
          <h2 className="text-xl font-black text-slate-950">{initialItem ? "Edit record" : "Add record"}</h2>
        </div>
        {onCancel ? (
          <button className="icon-button" type="button" onClick={onCancel} aria-label="Cancel edit">
            <XCircle size={18} />
          </button>
        ) : null}
      </div>
      <form className="grid gap-3" onSubmit={handleSubmit}>
        <div className="grid grid-cols-3 gap-2 rounded-app bg-slate-100 p-1">
          {(["subscription", "trial", "appWallet"] as RecordType[]).map((type) => (
            <button
              key={type}
              className={`tab-button ${draft.type === type ? "tab-button-active" : ""}`}
              type="button"
              onClick={() => setValue("type", type)}
            >
              {type === "appWallet" ? "Wallet" : type[0].toUpperCase() + type.slice(1)}
            </button>
          ))}
        </div>
        <label className="field">
          Service
          <input value={draft.serviceName} onChange={(event) => setValue("serviceName", event.target.value)} required maxLength={80} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="field">
            Amount
            <input
              value={draft.amount}
              onChange={(event) => setValue("amount", Number(event.target.value))}
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
            />
          </label>
          <label className="field">
            Currency
            <select value={draft.currency} onChange={(event) => setValue("currency", event.target.value as CurrencyCode)}>
              {currencies.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="field">
            Cycle
            <select value={draft.cycle} onChange={(event) => setValue("cycle", event.target.value as BillingCycle)}>
              {cycles.map((cycle) => (
                <option key={cycle} value={cycle}>
                  {cycle.replace("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Next date
            <input value={draft.nextChargeDate} onChange={(event) => setValue("nextChargeDate", event.target.value)} type="date" required />
          </label>
        </div>
        {draft.type === "trial" ? (
          <label className="field">
            Trial ends
            <input value={draft.trialEndsAt || ""} onChange={(event) => setValue("trialEndsAt", event.target.value)} type="date" />
          </label>
        ) : null}
        {draft.type === "appWallet" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="field">
              Balance
              <input
                value={draft.walletBalance ?? 0}
                onChange={(event) => setValue("walletBalance", Number(event.target.value))}
                type="number"
                min="0"
                step="0.01"
              />
            </label>
            <label className="field">
              Low threshold
              <input
                value={draft.walletLowThreshold ?? 0}
                onChange={(event) => setValue("walletLowThreshold", Number(event.target.value))}
                type="number"
                min="0"
                step="0.01"
              />
            </label>
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="field">
            Category
            <input value={draft.category} onChange={(event) => setValue("category", event.target.value)} list="category-options" />
            <datalist id="category-options">
              {categories.map((category) => (
                <option key={category} value={category} />
              ))}
            </datalist>
          </label>
          <label className="field">
            Payment account
            <input value={draft.paymentAccount || ""} onChange={(event) => setValue("paymentAccount", event.target.value)} />
          </label>
        </div>
        <label className="field">
          Cancel URL
          <input value={draft.cancelUrl || ""} onChange={(event) => setValue("cancelUrl", event.target.value)} type="url" />
        </label>
        <label className="field">
          Reminder days before
          <input
            value={(draft.reminderDays || []).join(", ")}
            onChange={(event) => setValue("reminderDays", parseReminderDays(event.target.value))}
            placeholder="7, 1"
          />
        </label>
        <label className="field">
          Notes
          <textarea value={draft.notes || ""} onChange={(event) => setValue("notes", event.target.value)} maxLength={220} />
        </label>
        <button className="button button-primary" type="submit">
          <Plus size={18} />
          {initialItem ? "Save changes" : "Add to radar"}
        </button>
      </form>
    </section>
  );
}

function AIView({
  candidates,
  onCreateCandidate,
  onConfirm,
  onReject,
}: {
  candidates: AIExtractionCandidate[];
  onCreateCandidate: (candidate: AIExtractionCandidate) => Promise<void>;
  onConfirm: (candidate: AIExtractionCandidate, draft: RenewalDraft) => Promise<void>;
  onReject: (candidate: AIExtractionCandidate) => Promise<void>;
}) {
  const [rawText, setRawText] = useState("Netflix renews Jun 10 for $15.49 monthly. Cancel at https://netflix.com/cancel");
  const [selected, setSelected] = useState<AIExtractionCandidate | null>(candidates.find((candidate) => candidate.status === "pending") || null);
  const [ocrStatus, setOcrStatus] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const pending = candidates.filter((candidate) => candidate.status === "pending");

  const handleParseText = async () => {
    const candidate = parseRenewalText(rawText, "text");
    await onCreateCandidate(candidate);
    setSelected(candidate);
  };

  const handleScreenshot = async (file?: File) => {
    if (!file) return;
    setOcrStatus("Loading OCR models (English + Chinese)");
    try {
      const text = await runLocalOcr(file, (status, progress) => {
        setOcrStatus(`${status} ${Math.round(progress * 100)}%`);
      });
      if (text.length < 4) {
        setOcrStatus("OCR returned too little text");
        return;
      }
      const candidate = parseRenewalText(text, "screenshot");
      await onCreateCandidate(candidate);
      setSelected(candidate);
      setRawText(text);
      setOcrStatus("OCR complete");
    } catch (error) {
      setOcrStatus(error instanceof Error ? error.message : "OCR failed");
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_430px]">
      <section className="panel">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="eyebrow">AI intake</p>
            <h2 className="text-xl font-black text-slate-950">Extract, then confirm</h2>
          </div>
          <span className="status-pill bg-radar-violetSoft text-radar-violet">{pending.length} pending</span>
        </div>
        <div className="grid gap-3">
          <label className="field">
            One-line input
            <textarea value={rawText} onChange={(event) => setRawText(event.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button className="button button-primary" type="button" onClick={handleParseText}>
              <Sparkles size={18} />
              Create candidate
            </button>
            <button className="button" type="button" onClick={() => fileInputRef.current?.click()}>
              <ImageIcon size={18} />
              Screenshot OCR
            </button>
            <input
              ref={fileInputRef}
              className="hidden"
              type="file"
              accept="image/*"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                void handleScreenshot(file);
                event.currentTarget.value = "";
              }}
            />
            {ocrStatus ? <span className="status-pill bg-slate-100 text-slate-600">{ocrStatus}</span> : null}
          </div>
        </div>

        <div className="mt-5 grid gap-3">
          {candidates.length ? (
            candidates.map((candidate) => (
              <CandidateCard
                key={candidate.id}
                candidate={candidate}
                selected={selected?.id === candidate.id}
                onSelect={() => setSelected(candidate)}
                onReject={() => onReject(candidate)}
              />
            ))
          ) : (
            <EmptyState title="No candidates" body="Parsed records will appear here before they enter the ledger." />
          )}
        </div>
      </section>

      <div className="grid gap-4">
        {selected ? (
          <CandidateConfirmPanel candidate={selected} onConfirm={(draft) => onConfirm(selected, draft)} onReject={() => onReject(selected)} />
        ) : (
          <section className="panel">
            <EmptyState title="No candidate selected" body="Select a pending extraction to review fields." />
          </section>
        )}
        <EvaluationPanel />
      </div>
    </div>
  );
}

function CandidateCard({
  candidate,
  selected,
  onSelect,
  onReject,
}: {
  candidate: AIExtractionCandidate;
  selected: boolean;
  onSelect: () => void;
  onReject: () => void;
}) {
  const statusTone =
    candidate.status === "confirmed"
      ? "bg-radar-greenSoft text-radar-green"
      : candidate.status === "rejected"
        ? "bg-red-50 text-red-700"
        : "bg-radar-amberSoft text-radar-amber";
  return (
    <article className={`rounded-app border p-3 ${selected ? "border-radar-green bg-radar-greenSoft/40" : "border-slate-200 bg-white"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <button className="min-w-0 text-left" type="button" onClick={onSelect}>
          <div className="flex flex-wrap items-center gap-2">
            <strong className="truncate text-base font-black text-slate-950">{candidate.fields.serviceName || "Unknown service"}</strong>
            <span className={`status-pill ${statusTone}`}>{candidate.status}</span>
            <span className="status-pill bg-radar-violetSoft text-radar-violet">{Math.round(candidate.confidence * 100)}%</span>
          </div>
          <p className="mt-2 line-clamp-2 text-sm font-semibold text-slate-600">{candidate.rawText}</p>
        </button>
        {candidate.status === "pending" ? (
          <button className="icon-button" type="button" onClick={onReject} aria-label="Reject candidate">
            <XCircle size={18} />
          </button>
        ) : null}
      </div>
      {candidate.warnings.length ? (
        <div className="mt-3 grid gap-1">
          {candidate.warnings.map((warning) => (
            <span key={warning} className="text-xs font-bold text-radar-amber">
              {warning}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function CandidateConfirmPanel({
  candidate,
  onConfirm,
  onReject,
}: {
  candidate: AIExtractionCandidate;
  onConfirm: (draft: RenewalDraft) => void;
  onReject: () => void;
}) {
  const [draft, setDraft] = useState<RenewalDraft>(() => normalizeDraft({ ...emptyDraft(), ...candidate.fields }));

  useEffect(() => {
    setDraft(normalizeDraft({ ...emptyDraft(), ...candidate.fields }));
  }, [candidate]);

  if (candidate.status !== "pending") {
    return (
      <section className="panel">
        <p className="eyebrow">Confirmation</p>
        <h2 className="text-xl font-black text-slate-950">Candidate {candidate.status}</h2>
        <p className="mt-2 text-sm font-semibold text-slate-600">Only pending candidates can be saved to the ledger.</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="mb-4">
        <p className="eyebrow">Human confirmation</p>
        <h2 className="text-xl font-black text-slate-950">Review extracted fields</h2>
      </div>
      <div className="grid gap-3">
        <label className="field">
          Service
          <input value={draft.serviceName} onChange={(event) => setDraft((current) => ({ ...current, serviceName: event.target.value }))} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="field">
            Amount
            <input value={draft.amount} onChange={(event) => setDraft((current) => ({ ...current, amount: Number(event.target.value) }))} type="number" />
          </label>
          <label className="field">
            Currency
            <select value={draft.currency} onChange={(event) => setDraft((current) => ({ ...current, currency: event.target.value as CurrencyCode }))}>
              {currencies.map((currency) => (
                <option key={currency}>{currency}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="field">
            Type
            <select value={draft.type} onChange={(event) => setDraft((current) => normalizeDraft({ ...current, type: event.target.value as RecordType }))}>
              <option value="subscription">Subscription</option>
              <option value="trial">Trial</option>
              <option value="appWallet">App wallet</option>
            </select>
          </label>
          <label className="field">
            Cycle
            <select value={draft.cycle} onChange={(event) => setDraft((current) => ({ ...current, cycle: event.target.value as BillingCycle }))}>
              {cycles.map((cycle) => (
                <option key={cycle} value={cycle}>
                  {cycle.replace("_", " ")}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          Next date
          <input value={draft.nextChargeDate} onChange={(event) => setDraft((current) => ({ ...current, nextChargeDate: event.target.value }))} type="date" />
        </label>
        <label className="field">
          Cancel URL
          <input value={draft.cancelUrl || ""} onChange={(event) => setDraft((current) => ({ ...current, cancelUrl: event.target.value }))} type="url" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button className="button button-primary" type="button" onClick={() => onConfirm(normalizeDraft(draft))}>
            <ClipboardCheck size={18} />
            Save
          </button>
          <button className="button button-danger" type="button" onClick={onReject}>
            <XCircle size={18} />
            Reject
          </button>
        </div>
      </div>
    </section>
  );
}

function EvaluationPanel() {
  const evaluation = runEvaluation();
  const failures = evaluation.failures.slice(0, 5);

  return (
    <section className="panel">
      <div className="mb-4">
        <p className="eyebrow">Evaluation</p>
        <h2 className="text-xl font-black text-slate-950">Extraction report</h2>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <MetricMini label="Samples" value={String(evaluation.datasetSize)} />
        <MetricMini label="Overall pass" value={formatPercent(evaluation.overallPassRate)} />
        <MetricMini label="Amount accuracy" value={formatPercent(evaluation.fieldAccuracy.amount || 0)} />
        <MetricMini label="Type accuracy" value={formatPercent(evaluation.fieldAccuracy.type || 0)} />
        <MetricMini label="Service accuracy" value={formatPercent(evaluation.fieldAccuracy.serviceName || 0)} />
        <MetricMini label="Cycle accuracy" value={formatPercent(evaluation.fieldAccuracy.cycle || 0)} />
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 rounded-app border border-slate-200 bg-slate-50 p-3">
        <span className="text-sm font-black text-slate-950">Average parser confidence</span>
        <span className="status-pill bg-radar-violetSoft text-radar-violet">{formatPercent(evaluation.averageConfidence)}</span>
      </div>
      <div className="mt-4">
        <h3 className="text-sm font-black text-slate-950">Failure cases</h3>
        <div className="mt-2 grid gap-2">
          {failures.length ? (
            failures.map((failure) => (
              <div key={`${failure.id}-${failure.field}`} className="rounded-app border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-sm font-black text-slate-950">
                    {failure.id} · {failure.field}
                  </strong>
                  <span className="status-pill bg-red-50 text-red-700">{failure.locale}</span>
                </div>
                <p className="mt-2 line-clamp-2 text-xs font-semibold text-slate-600">{failure.input}</p>
                <p className="mt-2 text-xs font-bold text-slate-500">
                  Expected {failure.expected}; got {failure.actual}
                </p>
              </div>
            ))
          ) : (
            <div className="rounded-app border border-slate-200 bg-slate-50 p-3">
              <strong className="text-sm font-black text-slate-950">No failures in this dataset</strong>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function MetricMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-app border border-slate-200 bg-slate-50 p-3">
      <strong className="block text-lg font-black text-slate-950">{value}</strong>
      <span className="text-xs font-bold text-slate-500">{label}</span>
    </div>
  );
}

function LedgerView({
  items,
  onEdit,
  onDelete,
  onRenew,
  onReviewed,
  onExportBackup,
  onImportBackup,
}: {
  items: RenewalItem[];
  onEdit: (item: RenewalItem) => void;
  onDelete: (item: RenewalItem) => void;
  onRenew: (item: RenewalItem) => void;
  onReviewed: (item: RenewalItem) => void;
  onExportBackup: () => void;
  onImportBackup: (file: File) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<RecordType | "all">("all");
  const importRef = useRef<HTMLInputElement | null>(null);
  const filtered = items.filter((item) => {
    const matchesType = type === "all" || item.type === type;
    const text = `${item.serviceName} ${item.category} ${item.notes || ""}`.toLowerCase();
    return matchesType && text.includes(query.toLowerCase());
  });

  return (
    <div className="grid gap-4">
      <section className="panel">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="eyebrow">IndexedDB ledger</p>
            <h2 className="text-xl font-black text-slate-950">Local records</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="button" type="button" onClick={onExportBackup}>
              <FileJson size={17} />
              Export JSON
            </button>
            <button className="button" type="button" onClick={() => importRef.current?.click()}>
              <Import size={17} />
              Import JSON
            </button>
            <input
              ref={importRef}
              className="hidden"
              type="file"
              accept="application/json"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void onImportBackup(file);
                event.currentTarget.value = "";
              }}
            />
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
          <label className="field">
            <span className="flex items-center gap-2">
              <Search size={16} />
              Search
            </span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <label className="field">
            Type
            <select value={type} onChange={(event) => setType(event.target.value as RecordType | "all")}>
              <option value="all">All</option>
              <option value="subscription">Subscription</option>
              <option value="trial">Trial</option>
              <option value="appWallet">App wallet</option>
            </select>
          </label>
        </div>
      </section>

      <section className="grid gap-3">
        {filtered.length ? (
          filtered.map((item) => (
            <LedgerRow key={item.id} item={item} onEdit={onEdit} onDelete={onDelete} onRenew={onRenew} onReviewed={onReviewed} />
          ))
        ) : (
          <section className="panel">
            <EmptyState title="No records" body="No local item matches this filter." />
          </section>
        )}
      </section>
    </div>
  );
}

function LedgerRow({
  item,
  onEdit,
  onDelete,
  onRenew,
  onReviewed,
}: {
  item: RenewalItem;
  onEdit: (item: RenewalItem) => void;
  onDelete: (item: RenewalItem) => void;
  onRenew: (item: RenewalItem) => void;
  onReviewed: (item: RenewalItem) => void;
}) {
  return (
    <article className="grid gap-3 rounded-app border border-slate-200 bg-white p-4 sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <strong className="truncate text-base font-black text-slate-950">{item.serviceName}</strong>
          <span className="status-pill bg-slate-100 text-slate-600">{item.type}</span>
          <span className="status-pill bg-radar-greenSoft text-radar-green">{item.source}</span>
        </div>
        <p className="mt-2 truncate text-sm font-semibold text-slate-600">
          {item.category} · {formatDate(item.nextChargeDate)} ·{" "}
          {item.type === "appWallet" ? `balance ${formatMoney(item.walletBalance || 0, item.currency)}` : formatMoney(item.amount, item.currency)}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <button className="icon-button" type="button" onClick={() => onReviewed(item)} aria-label="Mark reviewed">
          <CheckCircle2 size={18} />
        </button>
        <button className="icon-button" type="button" onClick={() => onRenew(item)} aria-label="Move to next cycle">
          <RefreshCcw size={18} />
        </button>
        <button className="icon-button" type="button" onClick={() => onEdit(item)} aria-label="Edit">
          <Edit3 size={18} />
        </button>
        <button className="icon-button" type="button" onClick={() => onDelete(item)} aria-label="Delete">
          <Trash2 size={18} />
        </button>
      </div>
    </article>
  );
}

function ReportView({
  items,
  candidates,
  onExportIcs,
  onExportBackup,
}: {
  items: RenewalItem[];
  candidates: AIExtractionCandidate[];
  onExportIcs: () => void;
  onExportBackup: () => void;
}) {
  const report = buildMonthlyReport(items, candidates);
  const typeCounts = items.reduce<Record<RecordType, number>>(
    (acc, item) => {
      acc[item.type] += 1;
      return acc;
    },
    { subscription: 0, trial: 0, appWallet: 0 }
  );

  return (
    <div className="grid gap-4">
      <section className="panel">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="eyebrow">Monthly report</p>
            <h2 className="text-xl font-black text-slate-950">Savings and privacy snapshot</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="button" type="button" onClick={onExportIcs}>
              <CalendarPlus size={17} />
              Calendar
            </button>
            <button className="button" type="button" onClick={onExportBackup}>
              <Download size={17} />
              Backup
            </button>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={Wallet} label="Monthly run-rate" value={formatCurrencyTotals(report.monthlyRunRateByCurrency)} tone="green" />
          <MetricCard icon={CircleDollarSign} label="Annualized" value={formatCurrencyTotals(report.annualizedRunRateByCurrency)} tone="blue" />
          <MetricCard icon={Bell} label="Trials at risk" value={String(report.trialsAtRisk)} tone="amber" />
          <MetricCard icon={Bot} label="AI confidence" value={`${Math.round(report.averageConfidence * 100)}%`} tone="violet" />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <CurrencyBreakdown title="Monthly by currency" totals={report.monthlyRunRateByCurrency} />
          <CurrencyBreakdown title="Annualized by currency" totals={report.annualizedRunRateByCurrency} />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="panel">
          <p className="eyebrow">Recommendations</p>
          <h2 className="text-xl font-black text-slate-950">Review queue</h2>
          <div className="mt-4 grid gap-3">
            {report.recommendations.map((item) => (
              <div key={item} className="rounded-app border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 text-radar-green" size={18} />
                  <p className="text-sm font-bold leading-6 text-slate-700">{item}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <p className="eyebrow">Portfolio proof</p>
          <h2 className="text-xl font-black text-slate-950">Product boundaries</h2>
          <div className="mt-4 grid gap-3">
            <BoundaryRow icon={Lock} title="No bank connection" body="The demo avoids account aggregation and financial advice." />
            <BoundaryRow icon={ShieldCheck} title="Local data" body="Records, AI candidates, and backups stay in browser storage." />
            <BoundaryRow icon={ClipboardCheck} title="Human confirmation" body="AI extraction results are candidates until approved." />
          </div>
          <div className="mt-5 grid grid-cols-3 gap-2">
            <MetricMini label="Subs" value={String(typeCounts.subscription)} />
            <MetricMini label="Trials" value={String(typeCounts.trial)} />
            <MetricMini label="Wallets" value={String(typeCounts.appWallet)} />
          </div>
        </section>
      </div>
    </div>
  );
}

function BoundaryRow({ icon: Icon, title, body }: { icon: typeof Lock; title: string; body: string }) {
  return (
    <div className="flex gap-3 rounded-app border border-slate-200 bg-slate-50 p-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-app bg-radar-greenSoft text-radar-green">
        <Icon size={18} />
      </span>
      <div>
        <strong className="text-sm font-black text-slate-950">{title}</strong>
        <p className="mt-1 text-xs font-semibold leading-5 text-slate-600">{body}</p>
      </div>
    </div>
  );
}

function CurrencyBreakdown({ title, totals }: { title: string; totals: CurrencyTotals }) {
  const entries = currencyEntries(totals);
  return (
    <div className="rounded-app border border-slate-200 bg-slate-50 p-3">
      <h3 className="text-sm font-black text-slate-950">{title}</h3>
      <div className="mt-3 grid gap-2">
        {entries.length ? (
          entries.map(([currency, amount]) => (
            <div key={currency} className="flex items-center justify-between gap-3 text-sm">
              <span className="font-bold text-slate-500">{currency}</span>
              <strong className="font-black text-slate-950">{formatMoney(amount, currency)}</strong>
            </div>
          ))
        ) : (
          <span className="text-sm font-bold text-slate-500">No recurring spend</span>
        )}
      </div>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="grid justify-items-center gap-2 rounded-app border border-dashed border-slate-300 p-8 text-center">
      <img className="w-32" src="./assets/empty-state.svg" alt="" />
      <strong className="text-base font-black text-slate-950">{title}</strong>
      <p className="max-w-sm text-sm font-semibold text-slate-600">{body}</p>
    </div>
  );
}

function emptyDraft(): RenewalDraft {
  const today = new Date();
  return {
    type: "subscription",
    serviceName: "",
    amount: 19.99,
    currency: "USD",
    cycle: "monthly",
    nextChargeDate: addDays(today, 7),
    category: "Subscription",
    paymentAccount: "",
    cancelUrl: "",
    notes: "",
    reminderDays: [7, 1],
    status: "active",
    tags: [],
  };
}

function itemToDraft(item: RenewalItem): RenewalDraft {
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, source: _source, ...draft } = item;
  return draft;
}

function normalizeDraft(draft: RenewalDraft): RenewalDraft {
  const type = draft.type;
  return {
    ...draft,
    amount: Number(draft.amount || 0),
    serviceName: draft.serviceName || "Untitled renewal",
    cycle: type === "appWallet" ? "top_up" : draft.cycle === "top_up" ? "monthly" : draft.cycle,
    nextChargeDate: draft.nextChargeDate || addDays(new Date(), 7),
    trialEndsAt: type === "trial" ? draft.trialEndsAt || draft.nextChargeDate : undefined,
    walletBalance: type === "appWallet" ? Number(draft.walletBalance || 0) : undefined,
    walletLowThreshold: type === "appWallet" ? Number(draft.walletLowThreshold || 10) : undefined,
    reminderDays: draft.reminderDays?.length ? draft.reminderDays : [7, 1],
    status: draft.status || (type === "subscription" ? "active" : "watching"),
    tags: draft.tags || [],
  };
}

function parseReminderDays(value: string): number[] {
  const days = value
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((day) => Number.isInteger(day) && day > 0 && day <= 365);
  return Array.from(new Set(days)).sort((a, b) => b - a);
}

function formatCurrencyTotals(totals: CurrencyTotals): string {
  const entries = currencyEntries(totals);
  if (!entries.length) return "No recurring spend";
  return entries.map(([currency, amount]) => formatMoney(amount, currency)).join(" · ");
}

function currencyEntries(totals: CurrencyTotals): Array<[CurrencyCode, number]> {
  return (Object.entries(totals) as Array<[CurrencyCode, number | undefined]>)
    .filter((entry): entry is [CurrencyCode, number] => typeof entry[1] === "number" && entry[1] > 0)
    .sort(([a], [b]) => a.localeCompare(b));
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function pluralize(label: string, count: number): string {
  return count === 1 ? label : `${label}s`;
}

function draftToItem(draft: RenewalDraft, source: RenewalItem["source"], existing?: RenewalItem): RenewalItem {
  const now = new Date().toISOString();
  return {
    ...normalizeDraft(draft),
    id: existing?.id || createId("item"),
    source,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    lastReviewedAt: existing?.lastReviewedAt,
  };
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export default App;
