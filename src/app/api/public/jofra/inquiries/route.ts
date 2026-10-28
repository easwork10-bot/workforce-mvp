import { NextRequest } from "next/server";
import { submitJofraPublicForm } from "@/backend/jofra/publicFormSubmission";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return submitJofraPublicForm(request, "inquiry");
}
