import { z } from "zod";

const noHeaderBreaks = (value: string) => !/[\r\n]/.test(value);
const plainText = (minimum: number, maximum: number) => z.string()
  .trim()
  .min(minimum)
  .max(maximum)
  .refine(noHeaderBreaks);
const optionalText = (maximum: number) => z.string()
  .trim()
  .max(maximum)
  .refine(noHeaderBreaks)
  .optional();
const emailAddress = z.string()
  .trim()
  .email()
  .max(254)
  .refine(noHeaderBreaks);

const calendarDate = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T12:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  });

const publicFormMetadata = {
  locale: z.enum(["nl", "ar"]),
  website: z.string().max(200).optional(),
};

export const businessInquirySchema = z.object({
  ...publicFormMetadata,
  companyName: plainText(2, 160),
  contactName: plainText(2, 100),
  email: emailAddress,
  phone: plainText(6, 40),
  location: plainText(2, 200),
  startDate: calendarDate,
  endDate: calendarDate,
  workingHours: plainText(2, 200),
  quantity: z.coerce.number().int().min(1).max(999),
  additionalInformation: z.string().trim().max(2000).optional(),
}).strict().superRefine((value, context) => {
  if (value.endDate < value.startDate) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endDate"],
      message: "Invalid date range",
    });
  }
});

export const jobApplicationSchema = z.object({
  ...publicFormMetadata,
  fullName: plainText(2, 100),
  email: emailAddress,
  city: plainText(2, 100),
  phone: optionalText(40),
  experience: optionalText(1200),
  qualifications: optionalText(1200),
  availability: optionalText(500),
  motivation: z.string().trim().max(2000).optional(),
}).strict();

export type BusinessInquiry = z.infer<typeof businessInquirySchema>;
export type JobApplication = z.infer<typeof jobApplicationSchema>;
export type JofraPublicFormType = "inquiry" | "application";
