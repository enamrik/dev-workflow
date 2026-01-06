# GitHub Abstraction Audit

**Issue #151** - Audit codebase for GitHub-specific leaks missing provider abstraction
**Date:** 2026-01-06

## Executive Summary

The ProjectManagementProvider abstraction is **partially complete**. The `gh` CLI calls are properly encapsulated in the infrastructure layer, but GitHub-specific types and naming have leaked into the **domain layer**, breaking the provider-agnostic design.

## Findings

### 1. `githubLabel` in Type Definition (SHOULD ABSTRACT)

**Location:** `packages/core/src/domain/type-definition.ts:24`

```typescript
export interface TypeDefinition {
  readonly name: string;
  readonly description: string;
  readonly githubLabel: string;  // <-- GitHub-specific naming
}
```

**Impact:** Domain model has provider-specific field name.

**Recommendation:** Rename to `remoteLabel` or `providerLabel`. This is a breaking change requiring:
- Schema migration (column rename)
- types.md file format update (if used)
- TypeService parsing update

**Priority:** MEDIUM - Cosmetic but breaks abstraction principle.

---

### 2. GitHub Sync Types in Domain Layer (SHOULD ABSTRACT)

**Location:** `packages/core/src/domain/github.ts`

The entire file defines GitHub-specific types that are imported into domain entities:

| Type | Used In | Issue |
|------|---------|-------|
| `GitHubSyncState` | `issue.ts`, `task.ts` | Domain entities depend on GitHub-specific type |
| `GitHubIssueData` | github-cli.ts, provider | Acceptable in infrastructure |
| `GitHubPRData` | github-cli.ts, provider | Acceptable in infrastructure |
| `GitHubSyncResult` | sync services | Acceptable in application |

**Impact:** Domain entities (`Issue`, `Task`) have `githubSync` property typed to `GitHubSyncState`.

**Recommendation:**
1. Create abstract `ProviderSyncState` interface in domain
2. Move `GitHubSyncState` to infrastructure as implementation
3. Rename `githubSync` property to `providerSync` or `remoteSync`

**Priority:** HIGH - Core abstraction leak. Required if supporting multiple providers.

---

### 3. Project Entity GitHub Reference (SHOULD ABSTRACT)

**Location:** `packages/core/src/domain/project.ts:25`

```typescript
readonly githubSync: GitHubIssueSyncConfig | null;
```

**Impact:** Project entity has GitHub-specific property.

**Recommendation:** Rename to `providerSync` or `remoteConfig`.

**Priority:** MEDIUM - Part of same abstraction leak as #2.

---

### 4. GitHub Sync Services (INTENTIONAL)

**Locations:**
- `packages/core/src/application/github-sync-service.ts`
- `packages/core/src/application/task-github-sync-service.ts`

**Verdict:** INTENTIONAL - These are GitHub-specific implementation services. They correctly live in the application layer and use the provider abstraction internally.

---

### 5. GitHub CLI Wrapper (INTENTIONAL)

**Location:** `packages/core/src/infrastructure/github/github-cli.ts`

**Verdict:** INTENTIONAL - Properly encapsulated in infrastructure layer. This is the correct place for GitHub-specific code.

---

### 6. GitHub Provider Implementation (INTENTIONAL)

**Location:** `packages/core/src/infrastructure/providers/github-project-management-provider.ts`

**Verdict:** INTENTIONAL - This is the provider implementation. GitHub-specific code belongs here.

---

### 7. Settings/Config References (INTENTIONAL)

**Location:** `packages/core/src/domain/project-management-config.ts`

```typescript
providerId: "github"  // Default provider
```

**Verdict:** INTENTIONAL - Configuration explicitly names the provider. The default being "github" is acceptable for backwards compatibility.

---

## Summary Table

| Finding | Category | Priority | Fix Now? |
|---------|----------|----------|----------|
| `githubLabel` field | SHOULD ABSTRACT | MEDIUM | No - cosmetic |
| `GitHubSyncState` in domain | SHOULD ABSTRACT | HIGH | No - major refactor |
| `githubSync` property names | SHOULD ABSTRACT | MEDIUM | No - part of #2 |
| GitHub sync services | INTENTIONAL | - | Keep as-is |
| GitHub CLI wrapper | INTENTIONAL | - | Keep as-is |
| GitHub provider impl | INTENTIONAL | - | Keep as-is |
| Config defaults | INTENTIONAL | - | Keep as-is |

## Recommendations

### Fix Now: None

The current state is functional. Fixing the abstraction leaks is a significant refactor that should be deferred until:
- A second provider (e.g., GitLab, Linear) is actually needed
- The refactor can be properly planned and tested

### Fix Later: Create Follow-up Issue

Create an issue to track the abstraction cleanup for when multi-provider support is needed:

1. Rename `githubLabel` to `remoteLabel` in TypeDefinition
2. Create abstract `ProviderSyncState` interface
3. Move `GitHubSyncState` to infrastructure
4. Rename `githubSync` properties to `providerSync`
5. Update database schema and migrations
6. Update all references

### Keep As-Is

- GitHub-specific services in application layer (they're implementation, not interface)
- GitHub CLI wrapper in infrastructure (correctly placed)
- GitHub provider implementation (correctly placed)
- Config defaults (backwards compatibility)

## Migration Path (For Future)

If abstraction is needed, the migration would involve:

1. **Schema change:** Add new columns with abstract names, migrate data, drop old columns
2. **Type changes:** Create abstract interfaces, update domain entities
3. **Service refactor:** Update sync services to use abstract types
4. **Test updates:** Update all tests to use abstract naming

Estimated effort: 2-3 days of focused work.
