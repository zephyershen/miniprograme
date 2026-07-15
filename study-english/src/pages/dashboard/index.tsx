import { Text, View } from "@tarojs/components";
import { useState } from "react";
import Taro from "@tarojs/taro";
import PageShell from "@/components/PageShell";
import Icon from "@/components/ui/Icon";
import { dashboardMetrics, dashboardBursts, levels } from "@/data/mock";

export default function DashboardPage() {
  const [selectedLevel] = useState("B1");

  const currentLevel = levels.find((l) => l.id === selectedLevel);

  return (
    <PageShell current="dashboard">
      {/* Header */}
      <View className="flex items-center justify-between mb-6 mt-2">
        <View className="flex items-center gap-3">
          <View
            className="flex items-center justify-center overflow-hidden"
            style={{
              width: "80rpx",
              height: "80rpx",
              borderRadius: "50%",
              background: "var(--brand-primary-light)",
              border: "4rpx solid #fff",
              boxShadow: "var(--shadow-sm)",
            }}
          >
            <Icon name="user" size={40} color="var(--brand-primary-dark)" />
          </View>
          <View>
            <Text style={{ fontSize: "24rpx", color: "var(--text-muted)", fontWeight: "500" }}>Good Morning,</Text>
            <Text className="block" style={{ fontSize: "32rpx", color: "var(--text-primary)", fontWeight: "700", letterSpacing: "-0.02em" }}>Alex</Text>
          </View>
        </View>
        <View
          className="flex items-center gap-1"
          style={{
            background: "#fff",
            borderRadius: "999px",
            padding: "8rpx 20rpx",
            boxShadow: "var(--shadow-sm)",
            border: "1rpx solid var(--border-light)",
          }}
        >
          <Icon name="flame" size={24} color="var(--brand-accent)" />
          <Text style={{ fontSize: "24rpx", fontWeight: "700", color: "var(--brand-accent)" }}>61</Text>
        </View>
      </View>

      {/* Current Level Card */}
      {currentLevel && (
        <View
          className="mb-6 relative overflow-hidden"
          style={{
            background: "var(--brand-primary)",
            borderRadius: "var(--radius-xl)",
            padding: "32rpx",
            boxShadow: "var(--shadow-clay-primary)",
          }}
          onClick={() => Taro.reLaunch({ url: "/pages/learn/index" })}
        >
          <View
            className="absolute pointer-events-none"
            style={{ right: "-30rpx", top: "-30rpx", width: "180rpx", height: "180rpx", borderRadius: "50%", background: "rgba(255,255,255,0.12)" }}
          />
          <View className="flex justify-between items-start relative" style={{ zIndex: 1 }}>
            <View>
              <View
                className="inline-flex items-center"
                style={{ background: "rgba(255,255,255,0.2)", borderRadius: "999px", padding: "6rpx 16rpx", marginBottom: "16rpx" }}
              >
                <Text style={{ color: "#fff", fontSize: "20rpx", fontWeight: "700", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                  {currentLevel.name}
                </Text>
              </View>
              <Text className="block" style={{ fontSize: "44rpx", fontWeight: "700", color: "#fff", lineHeight: "1.15", fontFamily: "var(--font-display)" }}>
                继续学习
              </Text>
              <Text className="block" style={{ color: "rgba(255,255,255,0.8)", fontSize: "26rpx", marginTop: "8rpx" }}>
                已掌握 {currentLevel.wordCount} 词 · +50 XP
              </Text>
            </View>
            <View
              className="flex items-center justify-center"
              style={{
                width: "96rpx",
                height: "96rpx",
                borderRadius: "50%",
                border: "6rpx solid rgba(255,255,255,0.3)",
              }}
            >
              <Text style={{ fontWeight: "700", fontSize: "24rpx", color: "#fff" }}>75%</Text>
            </View>
          </View>
          <View
            style={{
              marginTop: "28rpx",
              background: "#fff",
              color: "var(--brand-primary-dark)",
              textAlign: "center",
              padding: "24rpx 0",
              borderRadius: "999px",
              fontWeight: "700",
              fontSize: "28rpx",
              boxShadow: "0 8rpx 16rpx rgba(0,0,0,0.1)",
            }}
          >
            开始今日学习
          </View>
        </View>
      )}

      {/* Stats Row */}
      <View className="flex gap-3 mb-6">
        {dashboardMetrics.map((metric) => (
          <View
            key={metric.id}
            className="flex-1 flex flex-col items-center justify-center"
            style={{
              background: "var(--surface-default)",
              borderRadius: "var(--radius-lg)",
              padding: "24rpx 12rpx",
              boxShadow: "var(--shadow-md)",
              border: "1rpx solid var(--border-light)",
            }}
          >
            <Text style={{ fontSize: "44rpx", fontWeight: "700", color: metric.accent, fontFamily: "var(--font-display)" }}>
              {metric.value}{metric.suffix}
            </Text>
            <Text style={{ fontSize: "20rpx", color: "var(--text-muted)", fontWeight: "600", marginTop: "6rpx", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {metric.label}
            </Text>
          </View>
        ))}
      </View>

      {/* Quick Actions */}
      <View className="grid grid-cols-2 gap-3 mb-6">
        <View
          className="card-soft flex flex-col justify-between"
          onClick={() => Taro.reLaunch({ url: "/pages/discover/index" })}
        >
          <View
            className="flex items-center justify-center mb-4"
            style={{ width: "56rpx", height: "56rpx", borderRadius: "50%", background: "var(--brand-secondary-light)" }}
          >
            <Icon name="book" size={28} color="var(--brand-secondary)" />
          </View>
          <Text style={{ fontSize: "30rpx", fontWeight: "700", color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>场景表达</Text>
          <Text style={{ fontSize: "24rpx", color: "var(--text-muted)", marginTop: "4rpx" }}>8 个新场景</Text>
        </View>
        <View
          className="card-soft flex flex-col justify-between"
          onClick={() => Taro.showToast({ title: "每日测验即将开放", icon: "none" })}
        >
          <View
            className="flex items-center justify-center mb-4"
            style={{ width: "56rpx", height: "56rpx", borderRadius: "50%", background: "var(--brand-accent-light)" }}
          >
            <Icon name="star" size={28} color="var(--brand-accent)" />
          </View>
          <Text style={{ fontSize: "30rpx", fontWeight: "700", color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>每日测验</Text>
          <Text style={{ fontSize: "24rpx", color: "var(--text-muted)", marginTop: "4rpx" }}>10 题挑战</Text>
        </View>
      </View>

      {/* Quick Bursts */}
      <View className="mb-6">
        <Text className="section-title block mb-4">快速练习</Text>
        <View className="flex flex-col gap-3">
          {dashboardBursts.map((burst) => (
            <View
              key={burst.id}
              className="glass-panel flex items-center gap-4"
              style={{ padding: "24rpx" }}
              onClick={() => Taro.showToast({ title: burst.title, icon: "none" })}
            >
              <View
                style={{
                  width: "12rpx",
                  height: "60rpx",
                  borderRadius: "6rpx",
                  background: burst.accent.replace("bg-[", "").replace("]", ""),
                  flexShrink: 0,
                }}
              />
              <View className="flex-1">
                <Text style={{ fontSize: "28rpx", fontWeight: "700", color: "var(--text-primary)" }}>{burst.title}</Text>
                <Text style={{ fontSize: "24rpx", color: "var(--text-muted)", marginTop: "4rpx" }}>{burst.copy}</Text>
              </View>
              <Icon name="star" size={24} color="var(--text-muted)" />
            </View>
          ))}
        </View>
      </View>

      {/* Weekly Progress */}
      <View className="mb-4">
        <View className="flex justify-between items-end mb-4">
          <Text className="section-title">本周坚持</Text>
          <Text style={{ fontSize: "24rpx", fontWeight: "700", color: "var(--brand-primary)" }}>Week 4</Text>
        </View>
        <View className="card-soft flex justify-between items-end" style={{ paddingLeft: "24rpx", paddingRight: "24rpx", paddingTop: "24rpx", paddingBottom: "24rpx" }}>
          {["一", "二", "三", "四", "五", "六", "日"].map((day, i) => {
            const isToday = i === 3;
            const isCompleted = i < 3;
            const height = isCompleted ? 60 : isToday ? 40 : 20;
            const barColor = isCompleted ? "var(--brand-primary)" : isToday ? "var(--brand-accent)" : "var(--border-default)";
            return (
              <View key={`${day}-${i}`} className="flex flex-col items-center gap-2">
                <View style={{ width: "24rpx", borderRadius: "12rpx", height: `${height}rpx`, background: barColor }} />
                <Text style={{ fontSize: "22rpx", fontWeight: "700", color: isToday ? "var(--brand-accent)" : "var(--text-muted)" }}>{day}</Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* CEFR Level Roadmap */}
      <View className="mb-4">
        <Text className="section-title block mb-4">学习路线</Text>
        <View className="flex flex-col gap-3">
          {levels.map((level) => {
            const isCurrent = level.id === selectedLevel;
            const isPast = levels.indexOf(level) < levels.findIndex((l) => l.id === selectedLevel);
            return (
              <View
                key={level.id}
                className="glass-panel flex items-center gap-4"
                style={{
                  padding: "24rpx",
                  borderLeft: `6rpx solid ${level.color}`,
                  opacity: isPast ? 0.6 : 1,
                }}
              >
                <View
                  className="flex items-center justify-center"
                  style={{
                    width: "48rpx",
                    height: "48rpx",
                    borderRadius: "50%",
                    background: isCurrent ? level.color : isPast ? "var(--brand-primary-light)" : "var(--surface-accent)",
                    flexShrink: 0,
                  }}
                >
                  <Icon name={isPast ? "check" : "star"} size={24} color={isCurrent ? "#fff" : isPast ? "var(--brand-primary)" : "var(--text-muted)"} />
                </View>
                <View className="flex-1">
                  <Text style={{ fontSize: "28rpx", fontWeight: "700", color: "var(--text-primary)" }}>{level.name}</Text>
                  <Text style={{ fontSize: "22rpx", color: "var(--text-muted)", marginTop: "4rpx" }}>
                    {isPast ? "已完成" : isCurrent ? "学习中" : `${level.wordCount} 词`}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      </View>
    </PageShell>
  );
}
