import { useState } from "react";
import { useSuiteQuery } from "@/lib/suite-query";
import { useApiMutation } from "@/hooks/useApiMutation";
import { shrinkAndUpload } from "@/lib/uploadPhoto";
import { inputCls, primaryBtn } from "@/lib/ui-styles";
import Modal from "@/components/Modal";
import { RetryBlock } from "@/components/RetryBlock";
const domains: Record<string, string> = {
  metals: "cjmmetals.com",
  concrete: "cjmconcrete.com",
  insulation: "cjminsulation.com",
  trades: "cjmtrades.com",
};
export default function JobPublish({
  project,
  onClose,
}: {
  project: any;
  onClose: () => void;
}) {
  const q = useSuiteQuery<any[]>(
    ["suite-files", project.id],
    `/api/suite/jobs/${project.id}/files`,
  );
  const [title, setTitle] = useState(project.name),
    [url, setUrl] = useState(""),
    [approved, setApproved] = useState(false),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState("");
  const [requestKey] = useState(() => crypto.randomUUID());
  const save = useApiMutation({
    request: () => ({
      method: "POST",
      url: `/api/projects/${project.id}/publish-portfolio`,
      body: { title, photoUrl: url, approved, site: project.site, requestKey },
    }),
    successTitle: "Photo added to the selected trade’s public gallery",
    errorTitle: "Could not publish photo",
    onSuccess: onClose,
  });
  return (
    <Modal open onClose={onClose} title="Preview completed work">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <p>
          Public destination: <strong>{domains[project.site]}</strong>
        </p>
        {project.status !== "done" && (
          <p role="alert">
            Mark the job complete before publishing its finished work.
          </p>
        )}
        <label className="block">
          Public title
          <input
            required
            className={inputCls}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        {q.isError ? (
          <RetryBlock query={q} />
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {q.data
              ?.filter((f) => f.kind === "photo")
              .map((f) => (
                <button
                  type="button"
                  key={f.id}
                  className={`rounded border p-1 ${url === f.url ? "ring-2 ring-primary" : ""}`}
                  onClick={() => setUrl(f.url)}
                >
                  <img
                    alt={f.title}
                    src={f.thumbnail_url || f.url}
                    className="aspect-square object-cover"
                  />
                  <span className="text-xs">{f.title}</span>
                </button>
              ))}
          </div>
        )}
        <label className="block">
          Or upload a public photo
          <input
            type="file"
            accept="image/*"
            disabled={uploading}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setUploading(true);
              try {
                setUrl(await shrinkAndUpload(f));
              } catch (e: any) {
                setError(e.message);
              } finally {
                setUploading(false);
              }
            }}
          />
        </label>
        {url && (
          <figure className="rounded-xl border p-3">
            <img
              src={url}
              alt={title}
              className="max-h-64 w-full object-contain"
            />
            <figcaption className="mt-2 font-semibold">{title}</figcaption>
          </figure>
        )}
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={approved}
            onChange={(e) => setApproved(e.target.checked)}
          />
          I have approval to publish this title and photo publicly.
        </label>
        {error && <p role="alert">{error}</p>}
        <button
          className={primaryBtn}
          disabled={
            !approved ||
            !url ||
            save.isPending ||
            uploading ||
            project.status !== "done"
          }
        >
          Publish approved photo
        </button>
      </form>
    </Modal>
  );
}
