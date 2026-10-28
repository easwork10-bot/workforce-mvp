import "server-only";
import { Resend } from "resend";
import { z } from "zod";
import type {
  BusinessInquiry,
  JobApplication,
  JofraPublicFormType,
} from "@/shared/jofra-public-form-schemas";

const senderSchema = z.string().trim().max(320).refine((value) => {
  if (/[\r\n]/.test(value)) return false;
  const displayAddress = value.match(/^(?:"[^"\r\n]+"|[^<>"\r\n]+)\s+<([^<>]+)>$/);
  const mailbox = displayAddress?.[1] ?? value;
  return z.string().email().max(254).safeParse(mailbox).success;
});
const recipientSchema = z.string().trim().email().max(254).refine((value) => !/[\r\n]/.test(value));

const labels = {
  nl: {
    inquirySubject: "Aanvraag verkeersregelaars",
    applicationSubject: "Interesse in werken bij Jofra",
    companyName: "Bedrijf",
    contactName: "Contactpersoon",
    email: "E-mailadres",
    phone: "Telefoonnummer",
    location: "Projectlocatie",
    startDate: "Startdatum",
    endDate: "Einddatum",
    workingHours: "Werktijden",
    quantity: "Aantal verkeersregelaars",
    additionalInformation: "Aanvullende informatie",
    fullName: "Naam",
    city: "Woonplaats",
    experience: "Ervaring",
    qualifications: "Diploma's en kwalificaties",
    availability: "Beschikbaarheid",
    motivation: "Motivatie",
  },
  ar: {
    inquirySubject: "طلب منظّمي مرور",
    applicationSubject: "طلب اهتمام بالعمل لدى جوفرا",
    companyName: "الشركة",
    contactName: "جهة الاتصال",
    email: "البريد الإلكتروني",
    phone: "رقم الهاتف",
    location: "موقع المشروع",
    startDate: "تاريخ البدء",
    endDate: "تاريخ الانتهاء",
    workingHours: "ساعات العمل",
    quantity: "عدد منظّمي المرور",
    additionalInformation: "معلومات إضافية",
    fullName: "الاسم الكامل",
    city: "المدينة",
    experience: "الخبرة",
    qualifications: "المؤهلات والشهادات",
    availability: "التفرغ",
    motivation: "الدافع",
  },
} as const;

function safeBodyValue(value: string | number | undefined): string {
  if (value === undefined || value === "") return "—";
  return String(value)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function toPlainTextEmail(
  type: JofraPublicFormType,
  values: BusinessInquiry | JobApplication,
): { subject: string; text: string; replyTo: string; locale: "nl" | "ar" } {
  const language = labels[values.locale];
  if (type === "inquiry") {
    const inquiry = values as BusinessInquiry;
    const fields = [
      ["companyName", inquiry.companyName],
      ["contactName", inquiry.contactName],
      ["email", inquiry.email],
      ["phone", inquiry.phone],
      ["location", inquiry.location],
      ["startDate", inquiry.startDate],
      ["endDate", inquiry.endDate],
      ["workingHours", inquiry.workingHours],
      ["quantity", inquiry.quantity],
      ["additionalInformation", inquiry.additionalInformation],
    ] as const;
    return {
      subject: language.inquirySubject,
      text: fields.map(([key, value]) => `${language[key]}:\n${safeBodyValue(value)}`).join("\n\n"),
      replyTo: inquiry.email,
      locale: inquiry.locale,
    };
  }

  const application = values as JobApplication;
  const fields = [
    ["fullName", application.fullName],
    ["email", application.email],
    ["city", application.city],
    ["phone", application.phone],
    ["experience", application.experience],
    ["qualifications", application.qualifications],
    ["availability", application.availability],
    ["motivation", application.motivation],
  ] as const;
  return {
    subject: language.applicationSubject,
    text: fields.map(([key, value]) => `${language[key]}:\n${safeBodyValue(value)}`).join("\n\n"),
    replyTo: application.email,
    locale: application.locale,
  };
}

export async function sendJofraFormEmail(
  type: JofraPublicFormType,
  values: BusinessInquiry | JobApplication,
  idempotencyKey: string,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const configuredSender = senderSchema.safeParse(process.env.JOFRA_FORMS_FROM);
  const configuredRecipient = recipientSchema.safeParse(process.env.JOFRA_FORMS_TO);
  if (!apiKey || !configuredSender.success || !configuredRecipient.success) {
    throw new Error("Jofra email delivery is not configured");
  }

  const email = toPlainTextEmail(type, values);
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: configuredSender.data.includes("<")
      ? configuredSender.data
      : `Jofra Verkeer <${configuredSender.data}>`,
    to: [configuredRecipient.data],
    replyTo: email.replyTo,
    subject: email.subject,
    text: email.text,
  }, { idempotencyKey });

  if (error) throw new Error("Email provider rejected the message");
}
