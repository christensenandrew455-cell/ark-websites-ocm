export function formatUsd(cents = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(cents || 0) / 100);
}

export default function SubscriptionPlanCard({ plan, promotionalAmountCents = 0 }) {
  const savingsPercent = Math.max(0, Number(plan?.savingsPercent || 0));
  const showVolumeSavings = savingsPercent > 0;
  const lockedInPrice = Number(promotionalAmountCents || 0);
  const showLockedInPrice = lockedInPrice > 0 && lockedInPrice !== Number(plan?.amountCents || 0);

  return <>
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-xl font-black tracking-tight text-slate-950">{plan.name}</p>
        <p className="mt-2 text-sm font-bold text-slate-600">{plan.monthlyAcceptedLeads} accepted leads per month</p>
      </div>
      <div className="shrink-0 text-right">
        {showVolumeSavings && <p className="text-sm font-black text-slate-400 line-through decoration-2">{formatUsd(plan.listAmountCents)}</p>}
        <p className="text-xl font-black text-slate-950">{formatUsd(plan.amountCents)}<span className="ml-1 text-xs font-bold text-slate-500">/month</span></p>
        {showVolumeSavings && <p className="mt-1 inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-emerald-800">Save {savingsPercent}%</p>}
      </div>
    </div>
    {showLockedInPrice && <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-800">Website offer price: {formatUsd(lockedInPrice)}/month</p>}
  </>;
}
