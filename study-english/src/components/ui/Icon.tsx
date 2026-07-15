import { Text } from "@tarojs/components";

interface IconProps {
  name: "home" | "book" | "compass" | "user" | "check" | "flame" | "star";
  size?: number;
  color?: string;
}

const iconGlyphs: Record<IconProps["name"], string> = {
  home: "⌂",
  book: "▤",
  compass: "◎",
  user: "◉",
  check: "✓",
  flame: "▲",
  star: "★",
};

export default function Icon({ name, size = 24, color }: IconProps) {
  const iconColor = color ?? "var(--text-secondary)";

  return (
    <Text
      style={{
        fontSize: `${size}rpx`,
        lineHeight: `${size}rpx`,
        color: iconColor,
        display: "inline-block",
        textAlign: "center",
      }}
    >
      {iconGlyphs[name]}
    </Text>
  );
}
