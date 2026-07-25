import { EtfMappingProvider } from "@/hooks/useEtfMappingController";
import { EtfMappingLayout } from "./etfMapping/EtfMappingLayout";

export default function EtfMappingManager() {
  return (
    <EtfMappingProvider>
      <EtfMappingLayout />
    </EtfMappingProvider>
  );
}
