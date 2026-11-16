"use server";

import { redirect } from "next/navigation";
import { forBusiness } from "@/db/scope";
import { getSessionUser } from "@/modules/identity/session";
import { addNote, deleteNote, splitCustomer, updateCustomer } from "./records";

async function scopeFor(businessId: string) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return forBusiness(businessId, user.id);
}

/** Back to the customer's page, saying what happened. */
function back(businessId: string, recordId: string, result: { ok: boolean; error?: string } | null) {
  const path = `/dashboard/${businessId}/customers/${recordId}`;
  redirect(!result || !result.ok ? `${path}?notice=${result?.error ?? "forbidden"}` : `${path}?notice=saved`);
}

export async function updateCustomerAction(businessId: string, recordId: string, formData: FormData) {
  const scope = await scopeFor(businessId);
  const text = (name: string) => String(formData.get(name) ?? "");
  back(
    businessId,
    recordId,
    scope
      ? await updateCustomer(scope, recordId, {
          name: text("name"),
          phone: text("phone"),
          email: text("email").trim(),
          dateOfBirth: text("dateOfBirth"),
          allergies: text("allergies"),
        })
      : null,
  );
}

export async function addNoteAction(businessId: string, recordId: string, formData: FormData) {
  const scope = await scopeFor(businessId);
  back(businessId, recordId, scope ? await addNote(scope, recordId, String(formData.get("body") ?? "")) : null);
}

export async function deleteNoteAction(businessId: string, recordId: string, noteId: string) {
  const scope = await scopeFor(businessId);
  back(businessId, recordId, scope ? await deleteNote(scope, noteId) : null);
}

export async function splitCustomerAction(businessId: string, recordId: string, formData: FormData) {
  const scope = await scopeFor(businessId);
  if (!scope) back(businessId, recordId, null);
  const result = await splitCustomer(scope!, recordId, {
    bookingIds: formData.getAll("bookingIds").map(String),
    name: String(formData.get("name") ?? ""),
  });
  if (!result.ok) back(businessId, recordId, result);
  // Open the new record, so she can check it and fill in the rest.
  redirect(`/dashboard/${businessId}/customers/${(result as { newRecordId: string }).newRecordId}?notice=split`);
}
