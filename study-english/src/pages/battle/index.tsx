import { Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import Counter from "@/components/Counter";
import PageShell from "@/components/PageShell";
import { battleChallenges, battleLeaderboard } from "@/data/mock";

const podiumHeights = [270, 340, 238];

export default function BattlePage() {
  const [runnerUp, champion, thirdPlace] = [battleLeaderboard[1], battleLeaderboard[0], battleLeaderboard[2]];
  const podium = [runnerUp, champion, thirdPlace];

  return (
    <PageShell current="battle">
      <View className="glass-panel-strong p-6">
        <View className="flex items-center justify-between">
          <View className="chip-soft px-4 py-3">
            <Text className="ui-accent text-[20rpx] font-semibold uppercase tracking-[0.2em]">Battle Mode</Text>
          </View>
          <Text className="ui-text-soft text-[20rpx] uppercase tracking-[0.18em]">closes in 07:24</Text>
        </View>
        <Text className="hero-title display-lg ui-text-primary mt-4 block">
          用一点点竞争感，把今天的英语状态推高。
        </Text>
        <Text className="body-copy mt-4 block">
          好友 PK、排行榜和限时挑战会把原本枯燥的复习，变成一局很想赢下来的轻量游戏。
        </Text>

        <View className="mt-6 grid grid-cols-2 gap-3">
          <View className="surface-soft p-5">
            <Text className="section-kicker block">This Week</Text>
            <Counter value={368} suffix=" XP" className="ui-text-primary mt-3 block text-[52rpx] font-semibold" />
            <Text className="ui-text-secondary mt-3 block text-[26rpx] leading-[40rpx]">你离第一名还差 52 XP。</Text>
          </View>
          <View className="surface-soft p-5">
            <Text className="section-kicker block">Current Rank</Text>
            <Counter value={2} prefix="#" className="ui-text-primary mt-3 block text-[52rpx] font-semibold" />
            <Text className="ui-text-secondary mt-3 block text-[26rpx] leading-[40rpx]">今晚赢 1 局就能压过 Ethan。</Text>
          </View>
        </View>
      </View>

      <View className="mt-4 glass-panel p-5">
        <View className="flex items-center justify-between">
          <View>
            <Text className="section-kicker block">Leaderboard</Text>
            <Text className="section-title mt-3 block">本周 podium</Text>
          </View>
          <Text className="ui-text-soft text-[20rpx] uppercase tracking-[0.18em]">friends only</Text>
        </View>

        <View className="mt-6 flex items-end justify-between gap-3">
          {podium.map((player, index) => (
            <View key={player.id} className="flex flex-1 flex-col items-center">
              <View
                className="badge-orbit chip-soft flex h-[120rpx] w-[120rpx] items-center justify-center"
                style={{ boxShadow: `0 0 40px ${player.accent}22` }}
              >
                <Text className="ui-text-primary text-[38rpx] font-semibold">{player.name.slice(0, 1)}</Text>
              </View>
              <Text className="ui-text-primary mt-4 text-[28rpx] font-semibold">{player.name}</Text>
              <Text className="ui-text-soft mt-2 text-[22rpx]">{player.score} pts</Text>
              <View
                className="podium-glow mt-4 flex w-full items-end justify-center rounded-t-[40rpx]"
                style={{
                  height: `${podiumHeights[index]}rpx`,
                  backgroundImage: `linear-gradient(180deg, ${player.accent}, rgba(255,255,255,0.08))`,
                }}
              >
                <Text className="ui-text-primary mb-6 text-[42rpx] font-semibold">#{index + 1}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      <View className="mt-4">
        <View className="mb-3 flex items-center justify-between">
          <View>
            <Text className="section-kicker block">Live Challenges</Text>
            <Text className="section-title mt-3 block">今晚适合开的对战</Text>
          </View>
          <Text className="meta-copy">low-pressure, high dopamine</Text>
        </View>

        <View className="flex flex-col gap-3">
          {battleChallenges.map((challenge) => (
            <View key={challenge.id} className="glass-panel p-5">
              <View className="flex items-center justify-between gap-3">
                <View className="flex-1">
                  <Text className="ui-text-primary block text-[38rpx] font-semibold">{challenge.title}</Text>
                  <Text className="ui-text-secondary mt-3 block text-[28rpx] leading-[42rpx]">{challenge.copy}</Text>
                </View>
                <View className="rounded-full bg-[#f2c56c]/18 px-4 py-3">
                  <Text className="text-[22rpx] font-semibold text-[#ffe2a9]">{challenge.reward}</Text>
                </View>
              </View>
              <View
                className="button-pop chip-soft mt-5 inline-flex px-4 py-3"
                hoverClass="press-down-soft"
                hoverStayTime={70}
                onClick={() => Taro.showToast({ title: "下一版接入真实好友 battle", icon: "none" })}
              >
                <Text className="ui-text-primary text-[24rpx] font-semibold">发起挑战</Text>
              </View>
            </View>
          ))}
        </View>
      </View>
    </PageShell>
  );
}
