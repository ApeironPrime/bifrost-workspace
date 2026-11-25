export interface TransactionalMailer {
  readonly mode: "resend" | "webhook" | "log";
  readonly exposeDevCode: boolean;
  sendVerificationEmail(params: {
    to: string;
    name: string;
    code: string;
    verifyUrl: string;
  }): Promise<void>;
  sendPasswordResetEmail(params: {
    to: string;
    name: string;
    code: string;
    resetUrl: string;
  }): Promise<void>;
  sendWorkspaceInviteEmail(params: {
    to: string;
    workspaceName: string;
    inviterName: string;
    inviteUrl: string;
  }): Promise<void>;
}

interface MailPayload {
  to: string;
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function createMailerFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): TransactionalMailer {
  const resendApiKey = env.RESEND_API_KEY?.trim();
  const webhookUrl = env.EMAIL_WEBHOOK_URL?.trim();
  const from = env.EMAIL_FROM?.trim() || "Bifrost <onboarding@resend.dev>";
  const exposeDevCode =
    env.EMAIL_DEV_PREVIEW === "true" ||
    (env.NODE_ENV !== "production" && env.EMAIL_DEV_PREVIEW !== "false");

  const mode: TransactionalMailer["mode"] = resendApiKey
    ? "resend"
    : webhookUrl
      ? "webhook"
      : "log";

  async function dispatch(payload: MailPayload): Promise<void> {
    if (resendApiKey) {
      const response = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [payload.to],
          subject: payload.subject,
          text: payload.text,
          html: payload.html,
        }),
      });
      if (!response.ok) {
        console.error(`[mailer] Resend dispatch failed (${response.status})`);
      }
      return;
    }

    if (webhookUrl) {
      const response = await fetchImpl(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, ...payload }),
      });
      if (!response.ok) {
        console.error(`[mailer] Webhook dispatch failed (${response.status})`);
      }
      return;
    }

    console.info(`[mailer:log] to=${payload.to} subject="${payload.subject}"`);
  }

  return {
    mode,
    exposeDevCode,
    async sendVerificationEmail({ to, name, code, verifyUrl }) {
      const safeName = escapeHtml(name);
      const safeCode = escapeHtml(code);
      const safeUrl = escapeHtml(verifyUrl);
      await dispatch({
        to,
        subject: "Xác minh email tài khoản Bifrost",
        text: `Xin chào ${name},\n\nMã OTP xác minh email của bạn là: ${code}\nHoặc mở liên kết: ${verifyUrl}\n\nMã có hiệu lực trong 15 phút.`,
        html: `<p>Xin chào <strong>${safeName}</strong>,</p><p>Mã OTP xác minh email của bạn là: <strong style="font-size:20px;letter-spacing:3px">${safeCode}</strong></p><p>Hoặc nhấn vào liên kết sau: <a href="${safeUrl}">${safeUrl}</a></p><p>Mã có hiệu lực trong 15 phút.</p>`,
      });
    },
    async sendPasswordResetEmail({ to, name, code, resetUrl }) {
      const safeName = escapeHtml(name);
      const safeCode = escapeHtml(code);
      const safeUrl = escapeHtml(resetUrl);
      await dispatch({
        to,
        subject: "Đặt lại mật khẩu Bifrost",
        text: `Xin chào ${name},\n\nMã OTP đặt lại mật khẩu của bạn là: ${code}\nHoặc mở liên kết: ${resetUrl}\n\nMã có hiệu lực trong 15 phút. Nếu bạn không yêu cầu, hãy bỏ qua email này.`,
        html: `<p>Xin chào <strong>${safeName}</strong>,</p><p>Mã OTP đặt lại mật khẩu của bạn là: <strong style="font-size:20px;letter-spacing:3px">${safeCode}</strong></p><p>Hoặc mở liên kết: <a href="${safeUrl}">${safeUrl}</a></p><p>Mã có hiệu lực trong 15 phút.</p>`,
      });
    },
    async sendWorkspaceInviteEmail({ to, workspaceName, inviterName, inviteUrl }) {
      const safeWs = escapeHtml(workspaceName);
      const safeInviter = escapeHtml(inviterName);
      const safeUrl = escapeHtml(inviteUrl);
      await dispatch({
        to,
        subject: `${inviterName} mời bạn tham gia "${workspaceName}" trên Bifrost`,
        text: `${inviterName} đã mời bạn tham gia không gian làm việc "${workspaceName}" trên Bifrost.\n\nNhấn vào liên kết sau để tham gia: ${inviteUrl}`,
        html: `<p><strong>${safeInviter}</strong> đã mời bạn tham gia không gian làm việc <strong>${safeWs}</strong> trên Bifrost.</p><p><a href="${safeUrl}">Tham gia ngay trên Bifrost</a></p>`,
      });
    },
  };
}
