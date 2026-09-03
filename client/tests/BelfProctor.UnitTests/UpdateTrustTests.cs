using BelfProctor.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace BelfProctor.UnitTests;

public class UpdateTrustTests
{
    [Fact]
    public void UpdateDownloadSignature_MatchesServerProtocolVector()
    {
        Assert.Equal(
            "f2c08725b1092ab0a0348aea6ec7fcc113666c910330efd94268750c58569434",
            WebSocketAuth.CreateUpdateDownloadSignature(
                "CLIENT01",
                "2.1.0",
                1788381000,
                "device-key",
                "0123456789abcdef0123456789abcdef"));
    }

    [Theory]
    [InlineData("..")]
    [InlineData(".")]
    [InlineData("../escape")]
    [InlineData("1.0.0/escape")]
    [InlineData("_leading")]
    [InlineData("-leading")]
    public void SanitizeVersion_TraversalOrUnsafeName_FailsClosed(string version)
    {
        Assert.Throws<ArgumentException>(() => UpdateHelper.SanitizeVersion(version));
    }

    [Theory]
    [InlineData("1.0.0")]
    [InlineData("2026.09.03-rc_1")]
    public void SanitizeVersion_SafeName_IsPreserved(string version)
    {
        Assert.Equal(version, UpdateHelper.SanitizeVersion(version));
    }

    [Fact]
    public void UpdateStaging_IsInsideProtectedInstallRoot_ForBaseAndVersionedExecutables()
    {
        var installRoot = Path.Combine(Path.GetPathRoot(Environment.SystemDirectory)!,
            "Program Files", "BelfProctor");
        var baseExe = Path.Combine(installRoot, "BelfProctor.exe");
        var versionedExe = Path.Combine(installRoot, "versions", "2.0.3", "BelfProctor.exe");
        var expected = Path.Combine(installRoot, ".update");

        Assert.Equal(expected, UpdateHelper.ResolveUpdateRoot(baseExe), ignoreCase: true);
        Assert.Equal(expected, UpdateHelper.ResolveUpdateRoot(versionedExe), ignoreCase: true);
        Assert.False(UpdateHelper.ResolveUpdateRoot(baseExe)
            .StartsWith(Path.GetTempPath(), StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void Uninstaller_IsResolvedFromInstallRoot_ForBaseAndVersionedExecutables()
    {
        var installRoot = Path.Combine(Path.GetPathRoot(Environment.SystemDirectory)!,
            "Program Files", "BelfProctor");

        Assert.Equal(installRoot,
            UninstallHelper.ResolveInstallRoot(installRoot + Path.DirectorySeparatorChar),
            ignoreCase: true);
        Assert.Equal(installRoot,
            UninstallHelper.ResolveInstallRoot(Path.Combine(installRoot, "versions", "2.0.3")),
            ignoreCase: true);
    }

    [Theory]
    [InlineData("https://updates.example.test/a.exe", "https://cdn.example.test/a.exe", true)]
    [InlineData("https://updates.example.test/a.exe", "http://cdn.example.test/a.exe", false)]
    [InlineData("http://updates.example.test/a.exe", "https://cdn.example.test/a.exe", false)]
    public void IsHttpsUpdateResponse_RejectsAnyPlaintextHop(
        string requested, string final, bool expected)
    {
        Assert.Equal(expected, UpdateHelper.IsHttpsUpdateResponse(new Uri(requested), new Uri(final)));
    }

    [Fact]
    public void VerifyAuthenticodeSignature_MissingThumbprint_FailsClosed()
    {
        var path = Path.GetTempFileName();
        try
        {
            Assert.False(UpdateHelper.VerifyAuthenticodeSignature(path, "", NullLogger.Instance));
        }
        finally { File.Delete(path); }
    }

    [Fact]
    public void VerifyAuthenticodeSignature_UnsignedFile_FailsClosed()
    {
        var path = Path.GetTempFileName();
        try
        {
            File.WriteAllText(path, "not a signed executable");
            Assert.False(UpdateHelper.VerifyAuthenticodeSignature(
                path, "00112233445566778899AABBCCDDEEFF00112233", NullLogger.Instance));
        }
        finally { File.Delete(path); }
    }
}
