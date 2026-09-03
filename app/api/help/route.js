import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { getAdminDb } from "../../lib/firebase-admin";
import { HELP_KNOWLEDGE, HELP_LINKS } from "../../lib/helpContent";
import { LEGAL_KNOWLEDGE } from "../../lib/legalKnowledge";
import { requireUser } from "../../lib/userRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_LINKS = new Map(HELP_LINKS.map((link) => [link.href, link.label]));
const MAX_MESSAGES = 12;
const MAX_MESSAGE_LENGTH = 1500;
const CHAT_TTL_MS = 24 * 60 * 60 * 1000;
const FALLBACK_ANSWER = "Sorry, I can’t find that in the app guide. Open Support and describe what you need, or check Docs for the full guide.";
const FALLBACK_LINKS = [
  { href: "/messages", label: "Support" },
  { href: "/docs", label: "Docs" },
];

async function helpAccess(request) {
  const authorization = await requireUser(request);
  if (authorization.response) return authorization;
  const db = getAdminDb();
  const accountRef = db.collection("accounts").doc(authorization.clientId);
  const accountSnapshot = await accountRef.get();
  if (!accountSnapshot.exists || String(accountSnapshot.data().uid || "") !== String(authorization.decodedToken.uid || "")) {
    return { response: NextResponse.json({ error: "This account could not be found." }, { status: 404 }) };
  }
  return {
    ...authorization,
    helpRef: accountRef.collection("help").doc("current"),
  };
}

function cleanMessages(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((message) => message && (message.role === "user" || message.role === "assistant"))
    .slice(-MAX_MESSAGES)
    .map((message) => ({
      role: message.role,
      content: String(message.text || message.content || "").trim().slice(0, MAX_MESSAGE_LENGTH),
    }))
    .filter((message) => message.content);
}

function cleanLinks(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.slice(0, 4).flatMap((link) => {
    const href = String(link?.href || "").trim();
    if (!ALLOWED_LINKS.has(href) || seen.has(href)) return [];
    seen.add(href);
    return [{ href, label: ALLOWED_LINKS.get(href) }];
  });
}

function millis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (Number.isFinite(value.seconds)) return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function savedMessages(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-MAX_MESSAGES * 2).flatMap((message) => {
    const role = message?.role === "assistant" ? "assistant" : message?.role === "user" ? "user" : "";
    const text = String(message?.text || message?.content || "").trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!role || !text) return [];
    return [{
      id: String(message.id || crypto.randomUUID()),
      role,
      text,
      links: role === "assistant" ? cleanLinks(message.links) : [],
      createdAt: String(message.createdAt || new Date().toISOString()),
    }];
  });
}

async function saveHistory(access, incoming, answer, links) {
  const now = Date.now();
  const messages = [
    ...savedMessages(incoming),
    { id: crypto.randomUUID(), role: "assistant", text: answer, links, createdAt: new Date(now).toISOString() },
  ].slice(-MAX_MESSAGES * 2);
  await access.helpRef.set({
    messages,
    expiresAt: Timestamp.fromMillis(now + CHAT_TTL_MS),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function GET(request) {
  const access = await helpAccess(request);
  if (access.response) return access.response;
  const snapshot = await access.helpRef.get();
  const data = snapshot.exists ? snapshot.data() : {};
  const expiresAt = millis(data.expiresAt);
  if (snapshot.exists && (!expiresAt || expiresAt <= Date.now())) await access.helpRef.delete();
  return NextResponse.json({
    messages: expiresAt > Date.now() ? savedMessages(data.messages) : [],
    expiresAt: expiresAt > Date.now() ? expiresAt : 0,
  });
}

export async function DELETE(request) {
  const access = await helpAccess(request);
  if (access.response) return access.response;
  await access.helpRef.delete();
  return NextResponse.json({ ok: true });
}

export async function POST(request) {
  const access = await helpAccess(request);
  if (access.response) return access.response;

  try {
    const body = await request.json();
    const messages = cleanMessages(body.messages);
    const currentPath = String(body.currentPath || "/").slice(0, 200);
    if (!messages.length || messages[messages.length - 1].role !== "user") {
      return NextResponse.json({ error: "Ask a question about the app." }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "AI help is not configured yet. Open Docs for help." }, { status: 503 });
    }

    const model = String(process.env.OPENAI_HELP_MODEL || "gpt-4o-mini").trim();
    const systemPrompt = `You are the built-in help assistant for ARK Client Center. Explain how the app works and direct signed-in customers to the correct page. Answer the question directly, using everyday words and short steps when steps are needed. Use only the app documentation, Terms of Use, and Privacy Policy below. Treat exact labels, prices, time limits, definitions, and policy conditions as facts that must not be changed. Never invent features, promises, account status, request status, or customer data. Never claim that you performed an action. You cannot edit accounts, billing, clients, support requests, or policies. For legal or privacy questions, state which policy supports the answer and link to it.

If the documentation does not clearly answer the question, do not guess. Set "found" to false. The application will then direct the user to Support and Docs.

Return valid JSON only in this exact shape:
{"found":true,"answer":"A plain-language answer under 120 words.","links":[{"label":"Exact allowed label","href":"Exact allowed href"}]}

Use no more than three links. Only use these exact links:
${HELP_LINKS.map((link) => `- ${link.label}: ${link.href}`).join("\n")}

Current page: ${currentPath}

APP DOCUMENTATION:
${HELP_KNOWLEDGE}

LEGAL AND PRIVACY DOCUMENTATION:
${LEGAL_KNOWLEDGE}`;

    const openAiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 500,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
      }),
    });

    const openAiData = await openAiResponse.json().catch(() => ({}));
    if (!openAiResponse.ok) {
      console.error("OpenAI help request failed", openAiData);
      return NextResponse.json({ error: "AI help is temporarily unavailable. Open Docs or try again." }, { status: 502 });
    }

    const rawContent = openAiData?.choices?.[0]?.message?.content || "";
    let parsed;
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      parsed = { found: false, answer: "", links: [] };
    }

    const answer = String(parsed?.answer || "").trim();
    const answerSoundsUnknown = /(?:can(?:not|'t)|could(?: not|n't)) find|do not know|don't know|not in (?:the )?(?:docs|documentation)|no information/i.test(answer);
    if (parsed?.found === false || !answer || answerSoundsUnknown) {
      await saveHistory(access, body.messages, FALLBACK_ANSWER, FALLBACK_LINKS);
      return NextResponse.json({ answer: FALLBACK_ANSWER, links: FALLBACK_LINKS });
    }

    const finalAnswer = answer.slice(0, 2500);
    const finalLinks = cleanLinks(parsed?.links);
    await saveHistory(access, body.messages, finalAnswer, finalLinks);
    return NextResponse.json({ answer: finalAnswer, links: finalLinks });
  } catch (error) {
    console.error("Unable to answer help question", error);
    return NextResponse.json({ error: "AI help could not answer right now. Open Docs or try again." }, { status: 500 });
  }
}
