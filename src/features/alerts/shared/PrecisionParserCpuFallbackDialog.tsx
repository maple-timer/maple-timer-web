import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Banner } from "@astryxdesign/core/Banner";
import { HStack } from "@astryxdesign/core/HStack";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { Cpu, Gauge } from "lucide-react";
import type { PrecisionParserCpuFallbackState } from "../../../contracts/recognition/precisionParserRuntime";

export function PrecisionParserCpuFallbackDialog({
  isOpen,
  state,
  onOpenChange,
  onStart,
  onCancel,
}: {
  isOpen: boolean;
  state: PrecisionParserCpuFallbackState;
  onOpenChange: (isOpen: boolean) => void;
  onStart: () => Promise<void>;
  onCancel?: () => void;
}) {
  const isBenchmarking = state.status === "benchmarking";
  const canStart =
    state.status === "idle" ||
    state.status === "rejected" ||
    state.status === "failed";
  const closeDialog = () => {
    if (isBenchmarking) {
      onCancel?.();
    }
    onOpenChange(false);
  };

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          closeDialog();
          return;
        }
        onOpenChange(true);
      }}
      purpose="required"
      width={520}
    >
      <Layout
        header={
          <DialogHeader
            title="CPU로 정밀 감지 계속 사용"
            subtitle="현재 화면 공유가 끝날 때까지 적용됩니다"
            onOpenChange={(nextOpen) => {
              if (!nextOpen) {
                closeDialog();
              }
            }}
            startContent={<Cpu size={18} aria-hidden="true" />}
          />
        }
        content={
          <LayoutContent>
            <VStack gap={3}>
              <Text weight="semibold">
                약 5초 동안 CPU 속도를 확인한 뒤 정밀 감지를 시작합니다.
              </Text>
              <Text color="secondary">
                그래픽 가속보다 CPU 사용량이 늘어날 수 있습니다. 이 기기에서
                충분히 빠르게 처리할 수 있을 때만 CPU 모드로 전환합니다.
              </Text>
              <Text type="supporting" color="secondary">
                현재 화면을 약 5초 동안 여러 번 분석해 평균 속도와 느린 구간을
                함께 확인합니다. 화면이나 설정은 서버로 보내지 않습니다.
              </Text>
              {isBenchmarking ? (
                <Spinner
                  size="lg"
                  label="CPU 정밀 감지 속도를 확인하고 있습니다"
                />
              ) : null}
              {state.status === "rejected" ? (
                <Banner
                  status="error"
                  title="이 기기에서는 CPU 모드를 안정적으로 사용할 수 없습니다"
                  description={`5초 측정에서 한 화면 처리 평균은 약 ${Math.round(state.benchmark.requestAverageMs)}ms, 느린 구간은 약 ${Math.round(state.benchmark.requestP95Ms)}ms였습니다. 그래픽 설정을 확인하거나 백업 사이트를 이용해주세요.`}
                  container="card"
                />
              ) : null}
              {state.status === "failed" ? (
                <Banner
                  status="error"
                  title={
                    state.phase === "benchmark"
                      ? "CPU 속도를 확인하지 못했습니다"
                      : "CPU 정밀 감지를 계속할 수 없습니다"
                  }
                  description={
                    state.phase === "benchmark"
                      ? "화면 공유가 연결되어 있는지 확인한 뒤 다시 시도해주세요."
                      : "CPU 분석 중 오류가 발생했습니다. WebGPU 설정을 확인하거나 백업 사이트를 이용해주세요."
                  }
                  container="card"
                />
              ) : null}
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter>
            <HStack gap={2} hAlign="end" wrap="wrap">
              <Button label="취소" variant="secondary" onClick={closeDialog} />
              <Button
                label={
                  state.status === "rejected" || state.status === "failed"
                    ? "CPU 속도 다시 확인"
                    : "CPU 속도 확인 후 시작"
                }
                variant="primary"
                icon={<Gauge size={16} aria-hidden="true" />}
                isLoading={isBenchmarking}
                isDisabled={!canStart && !isBenchmarking}
                clickAction={onStart}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}
