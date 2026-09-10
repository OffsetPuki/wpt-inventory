import Header from "@/components/Header";
import StockHistory from "@/components/inventory/StockHistory";
export default function ActivityPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <Header
        title="Stock activity"
        description="Who moved stock, for which job, and how the count changed"
      />
      <StockHistory />
    </div>
  );
}
