import { z } from "zod";

export const inquirySchema = z.object({
  quantity: z.coerce.number().int().min(1).max(999),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const parsed = new Date(`${value}T12:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }),
  location: z.string().trim().min(2).max(200),
  hours: z.string().trim().min(2).max(200),
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().min(6).max(40),
});

export function inquiryMailto(values: z.infer<typeof inquirySchema>) {
  const body = [
    `Aantal verkeersregelaars / عدد منظّمي المرور: ${values.quantity}`,
    `Datum / التاريخ: ${values.date}`,
    `Locatie / الموقع: ${values.location}`,
    `Werktijden / ساعات العمل: ${values.hours}`,
    `Naam / الاسم: ${values.name}`,
    `E-mail: ${values.email}`,
    `Telefoon / الهاتف: ${values.phone}`,
  ].join("\n");
  return `mailto:info@jofraverkeer.nl?subject=${encodeURIComponent("Aanvraag verkeersregelaars / طلب منظّمي مرور")}&body=${encodeURIComponent(body)}`;
}
