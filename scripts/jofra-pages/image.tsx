import type { ImgHTMLAttributes } from "react";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string;
  fill?: boolean;
  priority?: boolean;
  unoptimized?: boolean;
};

export default function Image({
  fill = false,
  priority = false,
  unoptimized: _unoptimized,
  loading,
  style,
  ...props
}: Props) {
  return <img {...props} loading={priority ? "eager" : loading ?? "lazy"}
    style={fill ? { position: "absolute", inset: 0, width: "100%", height: "100%", ...style } : style} />;
}
