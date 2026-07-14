import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "@/components/ui/toaster";
import { useApiMutation } from "@/hooks/useApiMutation";
import { inputCls } from "@/lib/ui-styles";
import { LoadingBlock, EmptyState } from "@/components/ui/Feedback";
import Header from "@/components/Header";
import Modal from "@/components/Modal";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import type { KbArticle } from "@shared/pm-schema";
import { BookOpen, Loader2, Pencil, Pin, Plus, Search, Trash2 } from "lucide-react";

type KbRow = KbArticle & { authorName: string | null };

function parseTags(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((t) => typeof t === "string") : [];
  } catch {
    return [];
  }
}

// ─── Tiny markdown renderer ──────────────────────────────────────────────────
// Supports: # / ## headings, - bullets, paragraphs, **bold**, `code`.

function renderInline(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    .filter((p) => p !== "")
    .map((part, i) => {
      if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={i}>{part.slice(2, -2)}</strong>;
      if (/^`[^`]+`$/.test(part))
        return (
          <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
            {part.slice(1, -1)}
          </code>
        );
      return <span key={i}>{part}</span>;
    });
}

function renderMarkdown(content: string): ReactNode[] {
  const lines = content.split(/\r?\n/);
  const out: ReactNode[] = [];
  let para: string[] = [];
  let bullets: string[] = [];
  let key = 0;

  const flushPara = () => {
    if (para.length) {
      out.push(
        <p key={key++} className="text-sm leading-relaxed text-foreground">
          {renderInline(para.join(" "))}
        </p>
      );
      para = [];
    }
  };
  const flushBullets = () => {
    if (bullets.length) {
      out.push(
        <ul key={key++} className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-foreground">
          {bullets.map((b, i) => (
            <li key={i}>{renderInline(b)}</li>
          ))}
        </ul>
      );
      bullets = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith("## ")) {
      flushPara();
      flushBullets();
      out.push(
        <h4 key={key++} className="pt-2 text-base font-semibold text-foreground">
          {renderInline(line.slice(3))}
        </h4>
      );
    } else if (line.startsWith("# ")) {
      flushPara();
      flushBullets();
      out.push(
        <h3 key={key++} className="pt-2 text-lg font-semibold text-foreground">
          {renderInline(line.slice(2))}
        </h3>
      );
    } else if (line.startsWith("- ")) {
      flushPara();
      bullets.push(line.slice(2));
    } else if (line.trim() === "") {
      flushPara();
      flushBullets();
    } else {
      flushBullets();
      para.push(line);
    }
  }
  flushPara();
  flushBullets();
  return out;
}

// ─── Create / edit dialog ────────────────────────────────────────────────────

function ArticleDialog({
  open,
  onClose,
  article,
  categories,
}: {
  open: boolean;
  onClose: () => void;
  article: KbRow | null;
  categories: string[];
}) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState("");
  const [pinned, setPinned] = useState(false);
  const [content, setContent] = useState("");

  useEffect(() => {
    if (!open) return;
    setTitle(article?.title ?? "");
    setCategory(article?.category ?? "");
    setTags(parseTags(article?.tags ?? null).join(", "));
    setPinned(article?.pinned ?? false);
    setContent(article?.content ?? "");
  }, [open, article]);

  const save = useApiMutation({
    request: () => {
      const tagList = tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const payload = {
        title: title.trim(),
        category: category.trim() || null,
        tags: tagList.length ? JSON.stringify(tagList) : null,
        pinned,
        content,
      };
      return article
        ? { method: "PATCH", url: `/api/pm/kb/${article.id}`, body: payload }
        : { method: "POST", url: "/api/pm/kb", body: payload };
    },
    invalidate: [["pm-kb"]],
    successTitle: article ? "Article updated" : "Article created",
    errorTitle: "Could not save article",
    onSuccess: onClose,
  });

  const del = useApiMutation({
    request: () => ({ method: "DELETE", url: `/api/pm/kb/${article!.id}` }),
    invalidate: [["pm-kb"]],
    successTitle: "Article deleted",
    errorTitle: "Could not delete",
    onSuccess: onClose,
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={article ? "Edit article" : "New article"}
      maxWidth="max-w-2xl"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) {
            toast({ variant: "destructive", title: "Title is required" });
            return;
          }
          save.mutate();
        }}
        className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1"
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Title</span>
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Category</span>
            <input
              className={inputCls}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              list="kb-categories"
              placeholder="e.g. How-to"
            />
            <datalist id="kb-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Tags (comma-separated)</span>
            <input
              className={inputCls}
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="welding, safety"
            />
          </label>
        </div>
        <label className="flex items-center gap-2.5">
          <input
            type="checkbox"
            checked={pinned}
            onChange={(e) => setPinned(e.target.checked)}
            className="h-4 w-4 accent-[hsl(var(--primary))]"
          />
          <span className="text-sm font-medium text-foreground">Pin to the top of the list</span>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Content</span>
          <textarea
            className={cn(inputCls, "h-auto min-h-[220px] py-2 font-mono text-sm")}
            rows={12}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={"# Heading\n\nParagraph with **bold** and `code`.\n\n- Bullet one\n- Bullet two"}
          />
          <span className="text-xs text-muted-foreground">
            Supports # / ## headings, - bullets, **bold**, and `code`.
          </span>
        </label>

        <div className="mt-1 flex items-center gap-2">
          {article && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm("Delete this article?")) del.mutate();
              }}
              disabled={del.isPending}
              className="flex h-11 items-center gap-2 rounded-xl border border-border px-4 font-medium text-red-600 hover:border-red-500 disabled:opacity-60 dark:text-red-400"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          )}
          <button
            type="submit"
            disabled={save.isPending}
            className="ml-auto flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {article ? "Save changes" : "Create article"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Knowledge base page ─────────────────────────────────────────────────────

export default function PmKbPage() {
  const [q, setQ] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<KbRow | null>(null);
  const [viewing, setViewing] = useState<KbRow | null>(null);

  const { data: articles = [], isLoading } = useQuery<KbRow[]>({
    queryKey: ["pm-kb", q],
    queryFn: async () =>
      (
        await apiRequest("GET", `/api/pm/kb${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`)
      ).json(),
  });

  const categories = useMemo(
    () =>
      Array.from(
        new Set(articles.map((a) => a.category).filter((c): c is string => !!c))
      ).sort(),
    [articles]
  );

  const filtered = categoryFilter
    ? articles.filter((a) => a.category === categoryFilter)
    : articles;

  return (
    <div className="mx-auto max-w-6xl">
      <Header title="Knowledge base" description="How-tos, procedures, and shop know-how">
        <button
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
          className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-5 w-5" />
          New article
        </button>
      </Header>

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search articles…"
          className="h-12 w-full rounded-xl border border-input bg-card pl-12 pr-4 text-base text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring"
        />
      </div>

      {categories.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-1.5">
          <button
            onClick={() => setCategoryFilter("")}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
              !categoryFilter
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:border-primary hover:text-foreground"
            )}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategoryFilter(categoryFilter === c ? "" : c)}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                categoryFilter === c
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:border-primary hover:text-foreground"
              )}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {isLoading ? (
        <LoadingBlock />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          message={articles.length === 0 ? "No articles yet" : "No matches"}
        >
          {articles.length === 0 && (
            <button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
              className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90"
            >
              <Plus className="h-5 w-5" />
              Write the first article
            </button>
          )}
        </EmptyState>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border bg-card">
          {filtered.map((a) => {
            const tagList = parseTags(a.tags);
            return (
              <button
                key={a.id}
                onClick={() => setViewing(a)}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-accent/50"
              >
                {a.pinned ? (
                  <Pin className="h-4 w-4 shrink-0 text-amber-500" aria-label="Pinned" />
                ) : (
                  <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{a.title}</p>
                  {tagList.length > 0 && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {tagList.map((t) => `#${t}`).join("  ")}
                    </p>
                  )}
                </div>
                {a.category && (
                  <span className="hidden shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground sm:inline">
                    {a.category}
                  </span>
                )}
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatDate(a.updatedAt)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Article view */}
      <Modal
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing?.title ?? ""}
        maxWidth="max-w-2xl"
      >
        {viewing && (
          <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {viewing.pinned && (
                <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                  <Pin className="h-3.5 w-3.5" /> Pinned
                </span>
              )}
              {viewing.category && (
                <span className="rounded-full bg-muted px-2.5 py-0.5 font-medium">
                  {viewing.category}
                </span>
              )}
              {viewing.authorName && <span>by {viewing.authorName}</span>}
              <span>Updated {formatDate(viewing.updatedAt)}</span>
            </div>
            {parseTags(viewing.tags).length > 0 && (
              <p className="text-xs text-muted-foreground">
                {parseTags(viewing.tags)
                  .map((t) => `#${t}`)
                  .join("  ")}
              </p>
            )}
            <div className="flex flex-col gap-3">{renderMarkdown(viewing.content)}</div>
            <div className="flex justify-end">
              <button
                onClick={() => {
                  setEditing(viewing);
                  setViewing(null);
                  setDialogOpen(true);
                }}
                className="flex h-11 items-center gap-2 rounded-xl border border-border px-5 font-medium text-foreground hover:border-primary"
              >
                <Pencil className="h-4 w-4" />
                Edit
              </button>
            </div>
          </div>
        )}
      </Modal>

      <ArticleDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        article={editing}
        categories={categories}
      />
    </div>
  );
}
