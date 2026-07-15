import { Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import Icon from "@/components/ui/Icon";

export type TabKey = "dashboard" | "learn" | "discover" | "profile";

type TabDockProps = {
  current: TabKey;
};

const tabs: Array<{ key: TabKey; label: string; url: string; icon: "home" | "book" | "compass" | "user" }> = [
  { key: "dashboard", label: "Home", url: "/pages/dashboard/index", icon: "home" },
  { key: "learn", label: "Learn", url: "/pages/learn/index", icon: "book" },
  { key: "discover", label: "Discover", url: "/pages/discover/index", icon: "compass" },
  { key: "profile", label: "Profile", url: "/pages/profile/index", icon: "user" },
];

export default function TabDock({ current }: TabDockProps) {
  const onSwitch = (url: string, key: TabKey) => {
    if (key === current) return;
    Taro.reLaunch({ url });
  };

  return (
    <View className="nav-dock">
      {tabs.map((tab) => {
        const active = tab.key === current;
        return (
          <View
            key={tab.key}
            className={`nav-item ${active ? "nav-item-active" : ""}`}
            onClick={() => onSwitch(tab.url, tab.key)}
          >
            <View className="flex flex-col items-center justify-center">
              <View
                style={{
                  padding: "10rpx",
                  borderRadius: "50%",
                  background: active ? "var(--brand-primary-light)" : "transparent",
                }}
              >
                <Icon name={tab.icon} size={44} color={active ? "var(--brand-primary)" : "var(--text-muted)"} />
              </View>
              <Text
                style={{
                  fontSize: "20rpx",
                  fontWeight: active ? "700" : "500",
                  marginTop: "4rpx",
                  color: active ? "var(--brand-primary)" : "var(--text-muted)",
                }}
              >
                {tab.label}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}
