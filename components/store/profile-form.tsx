"use client";

import { useActionState } from "react";
import { updateProfileAction } from "@/app/(store)/account/actions";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import type { ActionResult } from "@/types";

interface Profile {
  full_name: string;
  phone: string;
  address: string;
  city: string;
  area: string;
}

export function ProfileForm({ profile }: { profile: Profile }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(updateProfileAction, { ok: false });
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="grid max-w-2xl gap-4 sm:grid-cols-2">
      <Field label="Full name" htmlFor="full_name" error={e.full_name} required>
        <Input id="full_name" name="full_name" defaultValue={profile.full_name} autoComplete="name" />
      </Field>
      <Field label="Mobile number" htmlFor="phone" error={e.phone}>
        <Input id="phone" name="phone" type="tel" defaultValue={profile.phone} placeholder="01XXXXXXXXX" autoComplete="tel" />
      </Field>
      <Field label="Address" htmlFor="address" error={e.address} className="sm:col-span-2">
        <Textarea id="address" name="address" rows={2} defaultValue={profile.address} autoComplete="street-address" />
      </Field>
      <Field label="District / City" htmlFor="city" error={e.city}>
        <Input id="city" name="city" defaultValue={profile.city} />
      </Field>
      <Field label="Thana / Area" htmlFor="area" error={e.area}>
        <Input id="area" name="area" defaultValue={profile.area} />
      </Field>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" loading={pending}>
          Save profile
        </Button>
        {state.message ? (
          <p className={state.ok ? "text-sm text-signal-dark" : "text-sm text-deal"} role="status">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
