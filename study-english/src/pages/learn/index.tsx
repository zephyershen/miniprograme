import { Text, View } from "@tarojs/components";
import { useState, useMemo } from "react";
import Taro from "@tarojs/taro";
import PageShell from "@/components/PageShell";
import Icon from "@/components/ui/Icon";
import { learnCards, levels } from "@/data/mock";

type SwipeDirection = "left" | "right";

const levelTabs = ["All", "A1", "A2", "B1", "B2", "C1"] as const;

export default function LearnPage() {
  const [selectedLevel, setSelectedLevel] = useState<string>("All");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [dragX, setDragX] = useState(0);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [touchOrigin, setTouchOrigin] = useState({ x: 0, y: 0 });
  const [masteredCount, setMasteredCount] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);

  const filteredCards = useMemo(
    () => (selectedLevel === "All" ? learnCards : learnCards.filter((c) => c.level === selectedLevel)),
    [selectedLevel],
  );

  const activeCards = filteredCards.slice(currentIndex, currentIndex + 3);
  const activeCard = filteredCards[currentIndex];

  const resetPosition = () => { setDragX(0); setDragY(0); setDragging(false); };

  const commitSwipe = (direction: SwipeDirection) => {
    if (!activeCard) return;
    if (direction === "right") setMasteredCount((v) => v + 1);
    else setReviewCount((v) => v + 1);

    setDragX(direction === "right" ? 420 : -420);
    setDragY(direction === "right" ? -20 : 20);
    setDragging(false);

    setTimeout(() => {
      setCurrentIndex((v) => v + 1);
      setDragX(0);
      setDragY(0);
    }, 200);
  };

  const onTouchStart = (e: any) => {
    if (!activeCard) return;
    const t = e.touches?.[0];
    if (!t) return;
    setTouchOrigin({ x: t.pageX, y: t.pageY });
    setDragging(true);
  };

  const onTouchMove = (e: any) => {
    if (!dragging || !activeCard) return;
    const t = e.touches?.[0];
    if (!t) return;
    setDragX(t.pageX - touchOrigin.x);
    setDragY((t.pageY - touchOrigin.y) * 0.15);
  };

  const onTouchEnd = () => {
    if (!activeCard) return;
    if (dragX > 100) { commitSwipe("right"); return; }
    if (dragX < -100) { commitSwipe("left"); return; }
    resetPosition();
  };

  const restartDeck = () => {
    setCurrentIndex(0);
    setMasteredCount(0);
    setReviewCount(0);
    resetPosition();
  };

  const switchLevel = (level: string) => {
    setSelectedLevel(level);
    setCurrentIndex(0);
    setMasteredCount(0);
    setReviewCount(0);
    resetPosition();
  };

  return (
    <PageShell current="learn">
      {/* Header */}
      <View className="flex items-center justify-between mb-3">
        <View>
          <Text className="section-kicker block">Daily Goal</Text>
          <Text className="section-title block" style={{ marginTop: "6rpx" }}>
            今日短语学习
          </Text>
        </View>
        <View className="chip-soft">
          <Text style={{ fontSize: "24rpx", fontWeight: "700", color: "var(--text-secondary)" }}>
            {Math.min(currentIndex + 1, filteredCards.length)} / {filteredCards.length}
          </Text>
        </View>
      </View>

      {/* Level Tabs */}
      <View className="flex gap-2 mb-4" style={{ flexWrap: "wrap" }}>
        {levelTabs.map((tab) => {
          const active = tab === selectedLevel;
          const levelInfo = levels.find((l) => l.id === tab);
          return (
            <View
              key={tab}
              style={{
                borderRadius: "999px",
                padding: "8rpx 20rpx",
                background: active ? "var(--brand-primary)" : "var(--surface-accent)",
                border: active ? "none" : "1rpx solid var(--border-default)",
              }}
              onClick={() => switchLevel(tab)}
            >
              <Text style={{ fontSize: "22rpx", fontWeight: "600", color: active ? "#fff" : "var(--text-secondary)" }}>
                {tab === "All" ? "全部" : levelInfo?.name ?? tab}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Score Bar */}
      <View className="flex gap-4 mb-4">
        <View className="flex items-center gap-1">
          <View style={{ width: "16rpx", height: "16rpx", borderRadius: "50%", background: "var(--brand-primary)" }} />
          <Text style={{ fontSize: "24rpx", fontWeight: "700", color: "var(--brand-primary)" }}>掌握 {masteredCount}</Text>
        </View>
        <View className="flex items-center gap-1">
          <View style={{ width: "16rpx", height: "16rpx", borderRadius: "50%", background: "var(--brand-accent)" }} />
          <Text style={{ fontSize: "24rpx", fontWeight: "700", color: "var(--brand-accent)" }}>待复习 {reviewCount}</Text>
        </View>
      </View>

      {/* Card Stack */}
      <View className="relative" style={{ height: "780rpx", marginTop: "16rpx" }}>
        {!activeCard ? (
          <View className="card-clay flex flex-col items-center justify-center h-full text-center">
            <View
              className="flex items-center justify-center mb-6"
              style={{ width: "120rpx", height: "120rpx", borderRadius: "50%", background: "var(--brand-primary-light)" }}
            >
              <Icon name="check" size={60} color="var(--brand-primary)" />
            </View>
            <Text style={{ fontSize: "44rpx", fontWeight: "700", color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>
              学完啦!
            </Text>
            <Text style={{ fontSize: "28rpx", color: "var(--text-muted)", marginTop: "12rpx", padding: "0 32rpx" }}>
              掌握 {masteredCount} 个，待复习 {reviewCount} 个
            </Text>
            <View className="w-full flex gap-3" style={{ marginTop: "40rpx" }}>
              <View className="btn-secondary flex-1" onClick={restartDeck}>
                <Text>再来一轮</Text>
              </View>
              <View className="btn-primary flex-1" onClick={() => Taro.reLaunch({ url: "/pages/dashboard/index" })}>
                <Text>返回首页</Text>
              </View>
            </View>
          </View>
        ) : (
          <View className="relative h-full w-full">
            {/* Swipe Hint Labels */}
            <View className="absolute inset-0 flex justify-between pointer-events-none" style={{ zIndex: 10, padding: "16rpx" }}>
              <View
                style={{
                  background: "#fff",
                  borderRadius: "999px",
                  padding: "8rpx 24rpx",
                  border: "4rpx solid var(--brand-accent)",
                  height: "fit-content",
                  opacity: dragX < -30 ? 1 : 0,
                }}
              >
                <Text style={{ color: "var(--brand-accent)", fontWeight: "700", fontSize: "24rpx" }}>待复习</Text>
              </View>
              <View
                style={{
                  background: "#fff",
                  borderRadius: "999px",
                  padding: "8rpx 24rpx",
                  border: "4rpx solid var(--brand-primary)",
                  height: "fit-content",
                  opacity: dragX > 30 ? 1 : 0,
                }}
              >
                <Text style={{ color: "var(--brand-primary)", fontWeight: "700", fontSize: "24rpx" }}>已掌握</Text>
              </View>
            </View>

            {activeCards
              .map((card, index) => ({ card, index }))
              .reverse()
              .map(({ card, index }) => {
                const isTop = index === 0;
                const translateY = index * 16;
                const scale = 1 - index * 0.04;
                const style = isTop
                  ? {
                      transform: `translate3d(${dragX}px, ${dragY}px, 0) rotate(${dragX / 28}deg)`,
                      transition: dragging ? "none" : "transform 0.2s ease-out",
                      zIndex: 30,
                      opacity: 1,
                    }
                  : {
                      transform: `translate3d(0, ${translateY}px, 0) scale(${scale})`,
                      transition: "transform 0.3s ease-out",
                      zIndex: 30 - index * 10,
                      opacity: 1 - index * 0.15,
                    };

                const levelColor = levels.find((l) => l.id === card.level)?.color ?? "var(--brand-primary)";

                return (
                  <View
                    key={card.id}
                    className="absolute inset-0 w-full h-full flex flex-col"
                    style={{
                      ...style,
                      background: "var(--surface-default)",
                      borderRadius: "var(--radius-xl)",
                      padding: "32rpx",
                      boxShadow: isTop ? "0 16rpx 48rpx rgba(15,23,42,0.1)" : "var(--shadow-sm)",
                    }}
                    onTouchStart={isTop ? onTouchStart : undefined}
                    onTouchMove={isTop ? onTouchMove : undefined}
                    onTouchEnd={isTop ? onTouchEnd : undefined}
                  >
                    {/* Level + Tag */}
                    <View className="flex items-center gap-2 mb-4">
                      <View style={{ background: levelColor, borderRadius: "999px", padding: "4rpx 14rpx" }}>
                        <Text style={{ fontSize: "20rpx", fontWeight: "700", color: "#fff" }}>{card.level}</Text>
                      </View>
                      <View className="chip-soft" style={{ padding: "4rpx 14rpx" }}>
                        <Text style={{ fontSize: "20rpx", color: "var(--text-muted)" }}>{card.tag}</Text>
                      </View>
                    </View>

                    {/* Word */}
                    <View className="flex-1 flex flex-col items-center justify-center text-center" style={{ marginTop: "-20rpx" }}>
                      <Text style={{ fontSize: "72rpx", fontWeight: "700", color: "var(--brand-primary-dark)", lineHeight: "1.1", fontFamily: "var(--font-display)" }}>
                        {card.word}
                      </Text>
                      <Text style={{ fontSize: "30rpx", color: "var(--text-muted)", marginTop: "8rpx" }}>
                        {card.phonetic}
                      </Text>
                      <Text style={{ fontSize: "34rpx", color: "var(--text-primary)", fontWeight: "500", marginTop: "24rpx" }}>
                        {card.meaning}
                      </Text>
                    </View>

                    {/* Example */}
                    <View style={{ background: "var(--surface-accent)", borderRadius: "var(--radius-lg)", padding: "24rpx", marginBottom: "8rpx" }}>
                      <Text style={{ fontSize: "22rpx", color: "var(--text-muted)", fontWeight: "700", letterSpacing: "0.08em", textTransform: "uppercase" }}>例句</Text>
                      <Text className="block" style={{ fontSize: "28rpx", color: "var(--text-primary)", marginTop: "8rpx", lineHeight: "1.5" }}>
                        "{card.example}"
                      </Text>
                      <Text style={{ fontSize: "22rpx", color: "var(--text-muted)", marginTop: "8rpx" }}>
                        场景: {card.scenario}
                      </Text>
                    </View>
                  </View>
                );
              })}
          </View>
        )}
      </View>

      {/* Action Buttons */}
      {activeCard && (
        <View className="flex gap-4 mt-6" style={{ paddingLeft: "16rpx", paddingRight: "16rpx" }}>
          <View
            className="flex-1 flex justify-center items-center gap-2"
            style={{
              background: "#fff",
              borderRadius: "999px",
              padding: "28rpx 0",
              boxShadow: "var(--shadow-md)",
              border: "1rpx solid var(--border-light)",
            }}
            onClick={() => commitSwipe("left")}
          >
            <View style={{ width: "16rpx", height: "16rpx", borderRadius: "50%", background: "var(--brand-accent)" }} />
            <Text style={{ fontSize: "30rpx", fontWeight: "700", color: "var(--text-primary)" }}>复习</Text>
          </View>
          <View
            className="flex-1 flex justify-center items-center gap-2"
            style={{
              background: "var(--brand-primary)",
              borderRadius: "999px",
              padding: "28rpx 0",
              boxShadow: "var(--shadow-clay-primary)",
            }}
            onClick={() => commitSwipe("right")}
          >
            <View style={{ width: "16rpx", height: "16rpx", borderRadius: "50%", background: "#fff" }} />
            <Text style={{ fontSize: "30rpx", fontWeight: "700", color: "#fff" }}>掌握</Text>
          </View>
        </View>
      )}
    </PageShell>
  );
}
