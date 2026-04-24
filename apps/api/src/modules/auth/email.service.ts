import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly settings: SettingsService) {
    const host = process.env['SMTP_HOST'];
    const port = Number(process.env['SMTP_PORT'] ?? 587);
    const user = process.env['SMTP_USER'];
    const pass = process.env['SMTP_PASS'];

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });
      this.logger.log(`Email transport configured via ${host}:${port}`);
    } else {
      this.logger.warn(
        'SMTP not configured (SMTP_HOST/SMTP_USER/SMTP_PASS missing). ' +
        'OTP login and password reset will be unavailable until SMTP is configured.',
      );
    }
  }

  get isConfigured(): boolean {
    return this.transporter !== null;
  }

  async sendEmail(to: string, subject: string, html: string): Promise<void> {
    if (!this.transporter) {
      throw new Error(
        'Email service is not configured (SMTP_HOST/SMTP_USER/SMTP_PASS missing). ' +
        'Cannot send email.',
      );
    }

    // Phase 3: prefer admin-editable sender identity from SystemSettings
    // (emailSenderName / emailSenderAddress). SMTP_FROM env var is a
    // legacy fallback kept for existing deployments.
    const [senderName, senderAddress] = await Promise.all([
      this.settings.get('emailSenderName'),
      this.settings.get('emailSenderAddress'),
    ]);
    const from = senderName && senderAddress
      ? `${senderName} <${senderAddress}>`
      : senderAddress
      ? senderAddress
      : process.env['SMTP_FROM'] ?? 'Challenge System <noreply@example.com>';

    try {
      await this.transporter.sendMail({ from, to, subject, html });
      this.logger.log(`Email sent to ${to}: ${subject}`);
    } catch (err) {
      this.logger.error(`Failed to send email to ${to}: ${String(err)}`);
      throw new Error('Failed to send email');
    }
  }

  async sendLoginCode(to: string, code: string): Promise<void> {
    await this.sendEmail(
      to,
      'קוד כניסה למערכת Challenge',
      `<div dir="rtl" style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #1e3a5f;">קוד הכניסה שלך</h2>
        <p style="font-size: 15px; color: #374151;">השתמשי בקוד הבא כדי להיכנס למערכת:</p>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px; text-align: center; margin: 20px 0;">
          <span style="font-size: 36px; font-weight: 700; letter-spacing: 0.2em; color: #1e3a5f;">${code}</span>
        </div>
        <p style="font-size: 13px; color: #94a3b8;">הקוד תקף ל-10 דקות ולשימוש חד-פעמי בלבד.</p>
      </div>`,
    );
  }

  async sendPasswordReset(to: string, resetUrl: string): Promise<void> {
    await this.sendEmail(
      to,
      'איפוס סיסמה — Challenge System',
      `<div dir="rtl" style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #1e3a5f;">איפוס סיסמה</h2>
        <p style="font-size: 15px; color: #374151;">לחצי על הקישור הבא כדי לאפס את הסיסמה שלך:</p>
        <div style="margin: 20px 0;">
          <a href="${resetUrl}" style="background: #2563eb; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">איפוס סיסמה</a>
        </div>
        <p style="font-size: 13px; color: #94a3b8;">הקישור תקף לשעה אחת ולשימוש חד-פעמי בלבד.</p>
        <p style="font-size: 13px; color: #94a3b8;">אם לא ביקשת איפוס סיסמה, אפשר להתעלם מהמייל הזה.</p>
      </div>`,
    );
  }
}
