import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "@/components/ui/toaster";
import type { Item } from "@shared/schema";
import Header from "@/components/Header";
import ItemForm from "@/components/ItemForm";
import { ArrowLeft, Loader2 } from "lucide-react";

export default function ItemEditPage({ id }: { id: string }) {
  const itemId = Number(id);
  const [, setLocation] = useLocation();
  const qc = useQueryClient();

  const { data: item, isLoading } = useQuery<Item>({
    queryKey: ["item", itemId],
    queryFn: async () => (await apiRequest("GET", `/api/items/${itemId}`)).json(),
  });

  const update = useMutation({
    mutationFn: async (payload: Record<string, any>) => {
      const res = await apiRequest("PATCH", `/api/items/${itemId}`, payload);
      return (await res.json()) as Item;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["item", itemId] });
      qc.invalidateQueries({ queryKey: ["item-detail", itemId] });
      qc.invalidateQueries({ queryKey: ["items"] });
      toast({ variant: "success", title: "Changes saved" });
      setLocation(`/item/${itemId}`);
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not save", description: e?.message }),
  });

  if (isLoading || !item) {
    return (
      <div className="flex justify-center py-20 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href={`/item/${itemId}`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to item
      </Link>
      <Header title="Edit Item" description={item.name} />
      <ItemForm
        mode="edit"
        initial={item}
        submitting={update.isPending}
        onSubmit={(payload) => update.mutate(payload)}
      />
    </div>
  );
}
