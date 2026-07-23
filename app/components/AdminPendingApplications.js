"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "./AuthProvider";

function formatDateTime(value) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function statusLabel(status) {
  if (status === "approved_pending_payment") return "Approved — waiting for billing";
  if (status === "declined") return "Declined";
  return "Pending verification";
}

function statusClass(status) {
  if (status === "approved_pending_payment") return "bg-blue-100 text-blue-800";
  if (status === "declined") return "bg-red-100 text-red-800";
  return "bg-amber-100 text-amber-800";
}

export default function AdminPendingApplications() {
  const { user } = useAuth();
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [portalTarget, setPortalTarget] = useState(null);

  async function adminFetch(url, options = {}) {
    const token = await user.getIdToken(true);
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "The administrator request failed.");
    return data;
  }

  async function loadApplications() {
    if (!user) return;
    const data = await adminFetch("/api/admin/signup-applications");
    setApplications(data.applications || []);
  }

  useEffect(() => {
    let active = true;
    if (!user) return undefined;

    adminFetch("/api/admin/signup-applications")
      .then((data) => {
        if (active) setApplications(data.applications || []);
      })
      .catch((loadError) => {
        if (active) setError(loadError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    const accountsTitle = Array.from(document.querySelectorAll("h1"))
      .find((element) => ["Connections", "Accounts"].includes(element.textContent?.trim()));
    const accountsHeader = accountsTitle?.parentElement?.parentElement;
    if (!accountsHeader) return undefined;

    const mountPoint = document.createElement("div");
    mountPoint.dataset.pendingVerification = "true";
    accountsHeader.insertAdjacentElement("afterend", mountPoint);
    setPortalTarget(mountPoint);

    return () => {
      mountPoint.remove();
    };
  }, []);

  async function decide(application, action) {
    const verb = action === "accept" ? "accept" : "decline";
    if (!window.confirm(`${verb.charAt(0).toUpperCase()}${verb.slice(1)} ${application.businessName}?`)) return;

    setBusyId(`${application.clientId}:${action}`);
    setError("");
    setMessage("");
    try {
      await adminFetch("/api/admin/signup-applications", {
        method: "POST",
        body: JSON.stringify({ clientId: application.clientId, action }),
      });
      await loadApplications();
      setMessage(action === "accept"
        ? `${application.businessName} was approved and can now add a payment method.`
        : `${application.businessName} was declined.`);
    } catch (decisionError) {
      setError(decisionError.message);
    } finally {
      setBusyId("");
    }
  }

  const panel = (
    <section className="mb-4 w-full sm:mb-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Account approval</p>
            <h2 className="mt-1 text-xl font-black sm:text-2xl">Pending Verification</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500 sm:text-sm">Review every new signup before Stripe billing and app access are unlocked.</p>
          </div>
          <span className="rounded-full bg-slate-950 px-3 py-1 text-xs font-black text-white">{applications.length}</span>
        </div>

        {error && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700 sm:text-sm">{error}</p>}
        {message && <p className="mt-4 rounded-xl border border-green-200 bg-green-50 p-3 text-xs font-bold text-green-800 sm:text-sm">{message}</p>}

        {loading ? (
          <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm font-semibold text-slate-500">Loading account applications…</p>
        ) : applications.length === 0 ? (
          <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm font-semibold text-slate-500">No accounts are waiting for verification.</p>
        ) : (
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {applications.map((application) => (
              <article key={application.clientId} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-lg font-black text-slate-950">{application.businessName}</h3>
                    <p className="mt-0.5 truncate font-mono text-[10px] text-slate-500">{application.clientId}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[9px] font-black uppercase ${statusClass(application.status)}`}>
                    {statusLabel(application.status)}
                  </span>
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                  <div><dt className="font-black uppercase tracking-wide text-slate-400">Owner</dt><dd className="mt-1 font-bold text-slate-800">{application.ownerName || "Not provided"}</dd></div>
                  <div><dt className="font-black uppercase tracking-wide text-slate-400">Phone</dt><dd className="mt-1 font-bold text-slate-800">{application.accountPhone || "Not provided"}</dd></div>
                  <div className="col-span-2"><dt className="font-black uppercase tracking-wide text-slate-400">Email</dt><dd className="mt-1 break-all font-bold text-slate-800">{application.accountEmail}</dd></div>
                  <div><dt className="font-black uppercase tracking-wide text-slate-400">Submitted</dt><dd className="mt-1 font-bold text-slate-800">{formatDateTime(application.createdAt)}</dd></div>
                  <div><dt className="font-black uppercase tracking-wide text-slate-400">Policies</dt><dd className="mt-1 font-bold text-slate-800">{application.termsAccepted && application.privacyAccepted ? "Accepted" : "Incomplete"}</dd></div>
                </dl>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={Boolean(busyId) || application.status === "approved_pending_payment"}
                    onClick={() => decide(application, "accept")}
                    className="rounded-xl bg-green-700 px-3 py-2.5 text-xs font-black text-white disabled:opacity-40"
                  >
                    {busyId === `${application.clientId}:accept` ? "Accepting…" : "Accept Account"}
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(busyId) || application.status === "declined"}
                    onClick={() => decide(application, "decline")}
                    className="rounded-xl border border-red-300 px-3 py-2.5 text-xs font-black text-red-700 disabled:opacity-40"
                  >
                    {busyId === `${application.clientId}:decline` ? "Declining…" : "Decline Account"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );

  return portalTarget ? createPortal(panel, portalTarget) : null;
}
