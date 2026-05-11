# envstore Homebrew formula
#
# Lives at: github.com/michael-ketzer/homebrew-envstore/Formula/envstore.rb
# Install:  brew tap michael-ketzer/envstore && brew install envstore
#
# Update procedure on each release:
#   1. Replace VERSION with the new tag (without the "v" prefix)
#   2. Update each `sha256` from the .sha256 file attached to the GitHub release
#      (the release workflow generates these automatically)
#   3. Commit and push to michael-ketzer/homebrew-envstore
#
# Users running `brew upgrade envstore` will pick up the new version
# automatically; they don't need to re-tap.

class Envstore < Formula
  desc "Zero-knowledge encrypted .env file storage"
  homepage "https://envstore.xyz"
  version "VERSION"
  license "AGPL-3.0-or-later"

  on_macos do
    on_arm do
      url "https://github.com/michael-ketzer/envstore.xyz/releases/download/v#{version}/envstore-darwin-arm64"
      sha256 "SHA256_DARWIN_ARM64"
    end
    on_intel do
      url "https://github.com/michael-ketzer/envstore.xyz/releases/download/v#{version}/envstore-darwin-x64"
      sha256 "SHA256_DARWIN_X64"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/michael-ketzer/envstore.xyz/releases/download/v#{version}/envstore-linux-arm64"
      sha256 "SHA256_LINUX_ARM64"
    end
    on_intel do
      url "https://github.com/michael-ketzer/envstore.xyz/releases/download/v#{version}/envstore-linux-x64"
      sha256 "SHA256_LINUX_X64"
    end
  end

  def install
    asset_name =
      if OS.mac? && Hardware::CPU.arm?
        "envstore-darwin-arm64"
      elsif OS.mac?
        "envstore-darwin-x64"
      elsif OS.linux? && Hardware::CPU.arm?
        "envstore-linux-arm64"
      else
        "envstore-linux-x64"
      end

    bin.install asset_name => "envstore"
  end

  test do
    assert_match(/envstore/, shell_output("#{bin}/envstore --version"))
  end
end
