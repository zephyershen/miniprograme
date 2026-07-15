import { Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import PageShell from "@/components/PageShell";
import Icon from "@/components/ui/Icon";
import { profileBadges, levels } from "@/data/mock";

const skills = [
  { label: "词汇量", value: 85, color: "#10b981" },
  { label: "口语", value: 60, color: "#f97316" },
  { label: "听力", value: 75, color: "#0ea5e9" },
  { label: "语法", value: 90, color: "#059669" },
  { label: "阅读", value: 82, color: "#7d84ff" },
  { label: "写作", value: 55, color: "#f2c56c" },
];

export default function ProfilePage() {
  return (
    <PageShell current="profile">
      {/* Profile Header */}
      <View className="flex flex-col items-center mt-6 mb-6 relative">
        <View
          className="flex items-center justify-center overflow-hidden mb-3"
          style={{
            width: "140rpx",
            height: "140rpx",
            borderRadius: "50%",
            background: "var(--brand-primary-light)",
            border: "6rpx solid #fff",
            boxShadow: "var(--shadow-md)",
          }}
        >
          <Icon name="user" size={70} color="var(--brand-primary-dark)" />
        </View>

        <View
          className="flex items-center gap-1"
          style={{
            background: "#fff",
            borderRadius: "999px",
            padding: "6rpx 16rpx",
            boxShadow: "var(--shadow-sm)",
            border: "1rpx solid var(--border-light)",
            marginTop: "-20rpx",
            position: "relative",
            zIndex: 2,
          }}
        >
          <Icon name="star" size={18} color="var(--brand-accent)" />
          <Text style={{ fontSize: "20rpx", fontWeight: "700", color: "var(--text-primary)" }}>Level 9 探索者</Text>
        </View>

        <Text style={{ fontSize: "44rpx", fontWeight: "700", color: "var(--text-primary)", fontFamily: "var(--font-display)", marginTop: "16rpx" }}>
          Alex Chen
        </Text>
        <Text style={{ fontSize: "26rpx", color: "var(--text-muted)", marginTop: "4rpx" }}>
          已学习 126 天 · 2026 年 1 月加入
        </Text>
      </View>

      {/* Key Stats */}
      <View className="flex gap-3 mb-6">
        {[
          { value: "61", label: "连续打卡", color: "var(--brand-primary)" },
          { value: "1.2k", label: "已学单词", color: "var(--brand-accent)" },
          { value: "42", label: "获得徽章", color: "var(--brand-secondary)" },
        ].map((stat) => (
          <View
            key={stat.label}
            className="flex-1 flex flex-col items-center justify-center"
            style={{
              background: "var(--surface-default)",
              borderRadius: "var(--radius-lg)",
              padding: "24rpx 12rpx",
              boxShadow: "var(--shadow-md)",
              border: "1rpx solid var(--border-light)",
            }}
          >
            <Text style={{ fontSize: "44rpx", fontWeight: "700", color: stat.color, fontFamily: "var(--font-display)" }}>
              {stat.value}
            </Text>
            <Text style={{ fontSize: "20rpx", color: "var(--text-muted)", fontWeight: "600", marginTop: "4rpx" }}>
              {stat.label}
            </Text>
          </View>
        ))}
      </View>

      {/* Skill Radar */}
      <View className="glass-panel-strong mb-6">
        <View className="flex justify-between items-end mb-5">
          <Text className="section-title">技能雷达</Text>
          <Text style={{ fontSize: "24rpx", fontWeight: "700", color: "var(--brand-primary)" }}>中级水平</Text>
        </View>
        <View className="flex flex-col gap-4">
          {skills.map((skill) => (
            <View key={skill.label}>
              <View className="flex justify-between items-center mb-2">
                <Text style={{ fontSize: "26rpx", fontWeight: "600", color: "var(--text-secondary)" }}>{skill.label}</Text>
                <Text style={{ fontSize: "24rpx", fontWeight: "700", color: "var(--text-primary)" }}>{skill.value}%</Text>
              </View>
              <View style={{ height: "14rpx", width: "100%", background: "var(--border-light)", borderRadius: "7rpx", overflow: "hidden" }}>
                <View style={{ height: "100%", borderRadius: "7rpx", width: `${skill.value}%`, background: skill.color }} />
              </View>
            </View>
          ))}
        </View>
      </View>

      {/* CEFR Progress */}
      <View className="glass-panel mb-6">
        <Text className="section-title block mb-4">等级进度</Text>
        <View className="flex flex-col gap-3">
          {levels.map((level, i) => {
            const progress = i === 0 ? 100 : i === 1 ? 100 : i === 2 ? 65 : i === 3 ? 20 : 0;
            const isActive = i === 2;
            return (
              <View key={level.id} className="flex items-center gap-3">
                <View
                  className="flex items-center justify-center"
                  style={{
                    width: "40rpx",
                    height: "40rpx",
                    borderRadius: "50%",
                    background: progress === 100 ? level.color : isActive ? level.color : "var(--surface-accent)",
                    flexShrink: 0,
                  }}
                >
                  {progress === 100 ? (
                    <Icon name="check" size={20} color="#fff" />
                  ) : (
                    <Text style={{ fontSize: "18rpx", fontWeight: "700", color: isActive ? "#fff" : "var(--text-muted)" }}>
                      {level.id}
                    </Text>
                  )}
                </View>
                <View className="flex-1">
                  <View className="flex justify-between items-center">
                    <Text style={{ fontSize: "24rpx", fontWeight: "600", color: "var(--text-primary)" }}>{level.name}</Text>
                    <Text style={{ fontSize: "22rpx", color: "var(--text-muted)" }}>{progress}%</Text>
                  </View>
                  <View style={{ height: "8rpx", background: "var(--border-light)", borderRadius: "4rpx", marginTop: "6rpx", overflow: "hidden" }}>
                    <View style={{ height: "100%", borderRadius: "4rpx", width: `${progress}%`, background: level.color }} />
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      </View>

      {/* Badges */}
      <View className="mb-6">
        <Text className="section-title block mb-4">成就徽章</Text>
        <View className="grid grid-cols-2 gap-3">
          {profileBadges.slice(0, 4).map((badge) => (
            <View key={badge.id} className="card-soft flex flex-col items-start">
              <View
                className="flex items-center justify-center mb-3"
                style={{ width: "52rpx", height: "52rpx", borderRadius: "50%", background: "var(--brand-accent-light)" }}
              >
                <Icon name="star" size={28} color="var(--brand-accent)" />
              </View>
              <Text style={{ fontSize: "28rpx", fontWeight: "700", color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>
                {badge.title}
              </Text>
              <Text style={{ fontSize: "22rpx", color: "var(--text-muted)", marginTop: "4rpx" }}>
                {badge.copy}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {/* Settings Quick Links */}
      <View className="glass-panel mb-6">
        <Text className="section-title block mb-4">设置</Text>
        {[
          { label: "学习提醒", desc: "每天 20:00 提醒学习" },
          { label: "每日目标", desc: "10 个新词 / 天" },
          { label: "学习偏好", desc: "商务英语 + 日常口语" },
        ].map((item) => (
          <View
            key={item.label}
            className="flex items-center justify-between"
            style={{ padding: "20rpx 0", borderBottom: "1rpx solid var(--border-light)" }}
            onClick={() => Taro.showToast({ title: "设置功能开发中", icon: "none" })}
          >
            <View>
              <Text style={{ fontSize: "28rpx", fontWeight: "600", color: "var(--text-primary)" }}>{item.label}</Text>
              <Text style={{ fontSize: "22rpx", color: "var(--text-muted)", marginTop: "2rpx" }}>{item.desc}</Text>
            </View>
            <Icon name="star" size={20} color="var(--text-muted)" />
          </View>
        ))}
      </View>

      {/* Share CTA */}
      <View
        className="btn-primary w-full flex items-center justify-center gap-2 mb-6"
        onClick={() => Taro.showToast({ title: "分享卡片生成中...", icon: "none" })}
      >
        <Text>分享我的学习进度</Text>
      </View>
    </PageShell>
  );
}
