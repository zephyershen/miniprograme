import { PropsWithChildren } from "react";
import { View } from "@tarojs/components";
import TabDock, { TabKey } from "@/components/TabDock";

type PageShellProps = PropsWithChildren<{
  current: TabKey;
}>;

export default function PageShell({ current, children }: PageShellProps) {
  return (
    <View className="app-container relative overflow-hidden" style={{ minHeight: "100vh", background: "var(--page-bg)" }}>
      <View
        className="absolute pointer-events-none"
        style={{
          top: "-80rpx",
          right: "-40rpx",
          width: "260rpx",
          height: "260rpx",
          borderRadius: "50%",
          background: "var(--brand-primary-light)",
          opacity: 0.35,
        }}
      />
      <View className="relative" style={{ zIndex: 1 }}>{children}</View>
      <TabDock current={current} />
    </View>
  );
}
