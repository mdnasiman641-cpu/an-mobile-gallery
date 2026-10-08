"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addStaffAction, removeStaffAction, updateStaffAction } from "@/app/admin/(panel)/users/actions";
import { adminTable } from "@/components/admin/page-header";
import { ConfirmButton, toastResult } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Badge } from "@/components/ui/misc";
import { formatDate } from "@/lib/utils";
import type { StaffRole } from "@/types";

export interface StaffRow {
  id: string;
  user_id: string;
  role: StaffRole;
  is_active: boolean;
  created_at: string;
  email: string | null;
  full_name: string | null;
}

const ROLE_HELP: Record<StaffRole, string> = {
  super_admin: "Everything, including staff accounts",
  admin: "Everything except staff accounts",
  editor: "Products, brands, categories, banners, pages, reviews",
};

export function StaffManager({ rows, currentUserId, canCreate }: { rows: StaffRow[]; currentUserId: string; canCreate: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<StaffRole>("editor");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  function add(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await addStaffAction({ email, password, role });
      setErrors(res.fieldErrors ?? {});
      if (toastResult(res)) {
        setEmail("");
        setPassword("");
        router.refresh();
      }
    });
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className={adminTable.wrap}>
        <table className={adminTable.table}>
          <thead>
            <tr>
              <th className={adminTable.th}>Staff member</th>
              <th className={adminTable.th}>Role</th>
              <th className={adminTable.th}>Access</th>
              <th className={adminTable.th}>Added</th>
              <th className={adminTable.th}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const self = r.user_id === currentUserId;
              return (
                <tr key={r.id}>
                  <td className={adminTable.td}>
                    <span className="font-semibold">{r.full_name || r.email}</span>
                    {self ? <span className="ml-1 text-xs text-ink-mute">(you)</span> : null}
                    <span className="block text-xs text-ink-mute">{r.email}</span>
                  </td>
                  <td className={adminTable.td}>
                    <select
                      className="h-9 rounded-md border border-line-strong bg-surface px-2 text-sm disabled:opacity-60"
                      defaultValue={r.role}
                      disabled={self}
                      aria-label={`Role for ${r.email}`}
                      onChange={(e) =>
                        start(async () => {
                          if (toastResult(await updateStaffAction(r.id, { role: e.target.value as StaffRole }))) router.refresh();
                        })
                      }
                    >
                      <option value="editor">Editor</option>
                      <option value="admin">Admin</option>
                      <option value="super_admin">Super admin</option>
                    </select>
                  </td>
                  <td className={adminTable.td}>
                    <Badge tone={r.is_active ? "signal" : "neutral"}>{r.is_active ? "Active" : "Suspended"}</Badge>
                  </td>
                  <td className={`${adminTable.td} text-xs text-ink-mute`}>{formatDate(r.created_at)}</td>
                  <td className={`${adminTable.td} text-right`}>
                    {!self ? (
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={pending}
                          onClick={() =>
                            start(async () => {
                              if (toastResult(await updateStaffAction(r.id, { is_active: !r.is_active }))) router.refresh();
                            })
                          }
                        >
                          {r.is_active ? "Suspend" : "Reactivate"}
                        </Button>
                        <ConfirmButton
                          title={`Remove staff access for ${r.email}?`}
                          description="Their account stays, but they can no longer open the admin panel."
                          confirmLabel="Remove access"
                          variant="ghost"
                          onConfirm={async () => {
                            const res = await removeStaffAction(r.id);
                            if (res.ok) router.refresh();
                            return res;
                          }}
                        >
                          Remove
                        </ConfirmButton>
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <form onSubmit={add} className="h-fit rounded-[var(--radius-card)] border border-line bg-surface p-5" aria-label="Add staff member">
        <h2 className="text-lg font-bold">Add staff member</h2>
        <div className="mt-4 grid gap-4">
          <Field label="Email" htmlFor="st-email" error={errors.email} required>
            <Input id="st-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          </Field>
          <Field
            label="Password for a new account"
            htmlFor="st-pass"
            error={errors.password}
            hint={canCreate ? "Only needed if this email has no account yet (10+ characters)." : "Server key not set: the person must register on the site first."}
          >
            <Input id="st-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" disabled={!canCreate} />
          </Field>
          <Field label="Role" htmlFor="st-role" hint={ROLE_HELP[role]}>
            <Select id="st-role" value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
              <option value="editor">Editor</option>
              <option value="admin">Admin</option>
              <option value="super_admin">Super admin</option>
            </Select>
          </Field>
        </div>
        <Button type="submit" className="mt-5" loading={pending}>
          Give access
        </Button>
      </form>
    </div>
  );
}
