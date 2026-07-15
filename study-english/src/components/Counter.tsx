import { Text } from "@tarojs/components";
import { useEffect, useState } from "react";

type CounterProps = {
  value: number;
  suffix?: string;
  prefix?: string;
  className?: string;
};

export default function Counter({ value, suffix = "", prefix = "", className = "" }: CounterProps) {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    const frames = 24;
    const stepDuration = 24;
    let frame = 0;
    const timer = setInterval(() => {
      frame += 1;
      const progress = Math.min(1, frame / frames);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(Math.round(value * eased));

      if (progress >= 1) {
        clearInterval(timer);
      }
    }, stepDuration);

    return () => {
      clearInterval(timer);
    };
  }, [value]);

  return (
    <Text className={`counter-number ${className}`}>
      {prefix}
      {displayValue}
      {suffix}
    </Text>
  );
}
