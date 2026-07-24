import { and, eq } from "drizzle-orm";
import type { FeatureFlag, SkillManifest } from "@webflowd/shared";
import { getDb, type Database } from "../db/client.js";
import { skills } from "../db/schema.js";
import { writeAudit } from "../audit/index.js";
import { TenantError, guardRow, type TenantContext } from "../tenancy/index.js";

export async function listSkills(ctx: TenantContext, database: Database = getDb()) {
  return database.query.skills.findMany({
    where: eq(skills.tenantId, ctx.tenantId),
    orderBy: (s, { asc }) => [asc(s.name)],
    limit: 500,
  });
}

export async function getSkill(ctx: TenantContext, key: string, database: Database = getDb()) {
  const row = await database.query.skills.findFirst({
    where: and(eq(skills.tenantId, ctx.tenantId), eq(skills.key, key)),
  });
  return guardRow(ctx, row ?? null);
}

/**
 * Install (or update) a skill from an admin-uploaded manifest. Upsert on
 * (tenant, key) so re-uploading a skill updates it in place. The manifest is
 * declarative — only instructions + pre-approved feature flags are persisted.
 */
export async function upsertSkillFromManifest(
  ctx: TenantContext,
  manifest: SkillManifest,
  source: "uploaded" | "builtin" = "uploaded",
  database: Database = getDb(),
) {
  const config = { featureFlags: manifest.featureFlags, settings: manifest.settings ?? {} };
  const [row] = await database
    .insert(skills)
    .values({
      tenantId: ctx.tenantId,
      key: manifest.key,
      name: manifest.name,
      description: manifest.description ?? null,
      category: manifest.category,
      instructions: manifest.instructions ?? null,
      config,
      enabled: manifest.enabled,
      source,
    })
    .onConflictDoUpdate({
      target: [skills.tenantId, skills.key],
      set: {
        name: manifest.name,
        description: manifest.description ?? null,
        category: manifest.category,
        instructions: manifest.instructions ?? null,
        config,
        enabled: manifest.enabled,
      },
    })
    .returning();
  await writeAudit(
    {
      tenantId: ctx.tenantId,
      actor: ctx.userId,
      action: "skill.upserted",
      entityType: "skill",
      entityId: row!.id,
      metadata: { key: manifest.key, featureFlags: manifest.featureFlags },
    },
    database,
  );
  return row!;
}

export async function setSkillEnabled(
  ctx: TenantContext,
  key: string,
  enabled: boolean,
  database: Database = getDb(),
) {
  const rows = await database
    .update(skills)
    .set({ enabled })
    .where(and(eq(skills.tenantId, ctx.tenantId), eq(skills.key, key)))
    .returning({ id: skills.id });
  if (rows.length === 0) throw new TenantError("Skill not found", 404);
  await writeAudit(
    {
      tenantId: ctx.tenantId,
      actor: ctx.userId,
      action: "skill.toggled",
      entityType: "skill",
      entityId: rows[0]!.id,
      metadata: { key, enabled },
    },
    database,
  );
}

export async function deleteSkill(ctx: TenantContext, key: string, database: Database = getDb()) {
  const rows = await database
    .delete(skills)
    .where(and(eq(skills.tenantId, ctx.tenantId), eq(skills.key, key)))
    .returning({ id: skills.id });
  if (rows.length === 0) throw new TenantError("Skill not found", 404);
  await writeAudit(
    {
      tenantId: ctx.tenantId,
      actor: ctx.userId,
      action: "skill.deleted",
      entityType: "skill",
      entityId: rows[0]!.id,
      metadata: { key },
    },
    database,
  );
}

type SkillRow = Awaited<ReturnType<typeof listSkills>>[number];

/** Reconstruct a re-importable manifest from a stored skill row. */
function skillRowToManifest(row: SkillRow): SkillManifest {
  const cfg = (row.config ?? {}) as {
    featureFlags?: FeatureFlag[];
    settings?: Record<string, string | number | boolean>;
  };
  return {
    key: row.key,
    name: row.name,
    category: row.category as SkillManifest["category"],
    featureFlags: cfg.featureFlags ?? [],
    enabled: row.enabled,
    ...(row.description ? { description: row.description } : {}),
    ...(row.instructions ? { instructions: row.instructions } : {}),
    ...(cfg.settings && Object.keys(cfg.settings).length ? { settings: cfg.settings } : {}),
  } satisfies SkillManifest;
}

/**
 * Export a tenant's installed skills as re-importable manifests — for backup, or
 * to clone one client's setup onto another. Each returned object round-trips
 * through `skillManifestSchema` and `upsertSkillFromManifest`.
 */
export async function exportSkills(
  ctx: TenantContext,
  database: Database = getDb(),
): Promise<SkillManifest[]> {
  const rows = await listSkills(ctx, database);
  return rows.map(skillRowToManifest);
}

/** Enabled skills' prompt instructions, for injection into the system prompt. */
export async function loadEnabledSkillInstructions(
  ctx: TenantContext,
  database: Database = getDb(),
): Promise<Array<{ name: string; instructions: string }>> {
  const rows = await database.query.skills.findMany({
    where: and(eq(skills.tenantId, ctx.tenantId), eq(skills.enabled, true)),
  });
  return rows
    .filter((r) => r.instructions && r.instructions.trim())
    .map((r) => ({ name: r.name, instructions: r.instructions! }));
}

/** The set of feature flags enabled by the tenant's active skills. */
export async function loadActiveFeatureFlags(
  ctx: TenantContext,
  database: Database = getDb(),
): Promise<FeatureFlag[]> {
  const rows = await database.query.skills.findMany({
    where: and(eq(skills.tenantId, ctx.tenantId), eq(skills.enabled, true)),
  });
  const flags = new Set<FeatureFlag>();
  for (const r of rows) {
    const cfg = (r.config ?? {}) as { featureFlags?: FeatureFlag[] };
    for (const f of cfg.featureFlags ?? []) flags.add(f);
  }
  return [...flags];
}
