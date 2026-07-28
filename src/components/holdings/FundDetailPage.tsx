import { useParams } from "react-router-dom";
import { FundDetailProvider } from "@/hooks/useFundDetailController";
import FundDetailLayout from "./fundDetail/FundDetailLayout";

/**
 * 基金详情页（路由组件）。
 * 仅做「从 URL 取 fundId + 包裹控制器 Provider」，所有状态/行为由 useFundDetailController 承担，
 * 布局与子卡片由 FundDetailLayout 组合（控制器见 useFundDetailController）。
 */
export default function FundDetailPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <FundDetailProvider fundId={id ?? ""}>
      <FundDetailLayout />
    </FundDetailProvider>
  );
}
