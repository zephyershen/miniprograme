import { Text, View } from "@tarojs/components";
import { useState } from "react";
import Taro from "@tarojs/taro";
import PageShell from "@/components/PageShell";
import { discoverFeed } from "@/data/mock";

const categoryTabs = ["全部", "Campus", "Office", "Pop", "Travel", "Interview"];

const posterColors = [
  { bg: "linear-gradient(180deg, rgba(255,138,61,0.18) 0%, rgba(248,250,252,1) 100%)", accent: "#ff8a3d" },
  { bg: "linear-gradient(180deg, rgba(120,220,195,0.18) 0%, rgba(248,250,252,1) 100%)", accent: "#78dcc3" },
  { bg: "linear-gradient(180deg, rgba(125,132,255,0.18) 0%, rgba(248,250,252,1) 100%)", accent: "#7d84ff" },
  { bg: "linear-gradient(180deg, rgba(242,197,108,0.18) 0%, rgba(248,250,252,1) 100%)", accent: "#f2c56c" },
];

export default function DiscoverPage() {
  const [activeTab, setActiveTab] = useState(0);

  const filteredFeed =
    activeTab === 0
      ? discoverFeed
      : discoverFeed.filter((item) =>
          item.category.toLowerCase().includes(categoryTabs[activeTab].toLowerCase()),
        );

  return (
    <PageShell current="discover">
      {/* Header */}
      <View className="mb-4 flex items-end justify-between">
        <View>
          <Text className="section-kicker block">Discover</Text>
          <Text className="hero-title block" style={{ marginTop: "8rpx" }}>
            场景化学英语
          </Text>
          <Text className="body-copy block" style={{ marginTop: "8rpx" }}>
            像刷短视频一样，顺手学会地道表达
          </Text>
        </View>
      </View>

      {/* Category Tabs */}
      <View className="flex gap-2 mb-5" style={{ flexWrap: "wrap" }}>
        {categoryTabs.map((tab, index) => (
          <View
            key={tab}
            style={{
              borderRadius: "999px",
              padding: "10rpx 24rpx",
              background: index === activeTab ? "var(--brand-primary)" : "var(--surface-accent)",
              border: index === activeTab ? "none" : "1rpx solid var(--border-default)",
            }}
            onClick={() => setActiveTab(index)}
          >
            <Text
              style={{
                fontSize: "22rpx",
                fontWeight: "600",
                color: index === activeTab ? "#fff" : "var(--text-secondary)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
              }}
            >
              {tab}
            </Text>
          </View>
        ))}
      </View>

      {/* Feed Cards */}
      <View className="flex flex-col gap-4">
        {filteredFeed.map((item, index) => {
          const colors = posterColors[index % posterColors.length];
          return (
            <View
              key={item.id}
              className="flex flex-col justify-between overflow-hidden"
              style={{
                minHeight: "640rpx",
                borderRadius: "var(--radius-xl)",
                padding: "32rpx",
                backgroundImage: colors.bg,
                border: "1rpx solid var(--border-light)",
              }}
            >
              {/* Top: Category + Bookmark */}
              <View className="flex items-center justify-between">
                <View className="chip-soft" style={{ borderColor: colors.accent }}>
                  <Text style={{ fontSize: "20rpx", fontWeight: "600", color: colors.accent, letterSpacing: "0.12em", textTransform: "uppercase" }}>
                    {item.category}
                  </Text>
                </View>
                <View
                  className="chip-soft"
                  onClick={() => Taro.showToast({ title: "已收藏", icon: "none" })}
                >
                  <Text style={{ fontSize: "22rpx", fontWeight: "600", color: "var(--text-primary)" }}>收藏</Text>
                </View>
              </View>

              {/* Middle: Title + Quote */}
              <View style={{ marginTop: "24rpx", flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                <Text style={{ fontSize: "40rpx", fontWeight: "700", color: "var(--text-primary)", lineHeight: "1.2", fontFamily: "var(--font-display)" }}>
                  {item.title}
                </Text>
                <Text style={{ marginTop: "20rpx", fontSize: "36rpx", fontWeight: "600", lineHeight: "1.3", color: colors.accent }}>
                  {item.quote}
                </Text>
                <Text style={{ marginTop: "12rpx", fontSize: "28rpx", color: "var(--text-secondary)", lineHeight: "1.5" }}>
                  {item.caption}
                </Text>
              </View>

              {/* Bottom: Meta + Actions */}
              <View style={{ marginTop: "20rpx" }}>
                <View className="flex items-center justify-between mb-3">
                  <Text style={{ fontSize: "22rpx", color: "var(--text-muted)", letterSpacing: "0.1em" }}>{item.meta}</Text>
                </View>
                <View className="flex gap-2 mb-3">
                  {["字幕", "跟读", "拆句"].map((action) => (
                    <View key={action} className="chip-soft" onClick={() => Taro.showToast({ title: `${action}功能即将上线`, icon: "none" })}>
                      <Text style={{ fontSize: "22rpx", fontWeight: "600", color: "var(--text-secondary)" }}>{action}</Text>
                    </View>
                  ))}
                </View>
                <View
                  className="cta-primary flex items-center justify-center"
                  style={{ borderRadius: "var(--radius-lg)", padding: "24rpx" }}
                  onClick={() => Taro.showToast({ title: "视频播放功能开发中", icon: "none" })}
                >
                  <Text style={{ fontSize: "30rpx", fontWeight: "600", color: "#fff" }}>开始学习</Text>
                </View>
              </View>
            </View>
          );
        })}

        {/* End of Feed */}
        <View className="empty-spotlight glass-panel" style={{ padding: "48rpx 32rpx" }}>
          <Text className="section-kicker block">Feed End</Text>
          <Text className="section-title block" style={{ marginTop: "16rpx" }}>
            今天先到这里
          </Text>
          <Text className="body-copy block" style={{ marginTop: "12rpx", textAlign: "center" }}>
            明天会根据你的兴趣和掌握度重新推荐内容
          </Text>
        </View>
      </View>
    </PageShell>
  );
}
