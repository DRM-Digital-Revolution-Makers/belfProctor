using BelfProctor;
using BelfProctor.Services;
using Xunit;

namespace BelfProctor.UnitTests;

public class CommandChannelWorkerTests
{
    [Fact]
    public void BuildWsUrl_Http_ReturnsWs()
    {
        var url = new Uri(CommandChannelWorker.BuildWsUrl("http://localhost:4000/api", "abc", "secret"));
        Assert.Equal("ws", url.Scheme);
        Assert.Equal("localhost", url.Host);
        Assert.Equal(4000, url.Port);
        Assert.Equal("/ws", url.AbsolutePath);
        Assert.Contains("clientId=abc", url.Query);
        Assert.Contains("&ts=", url.Query);
        Assert.Matches("[?&]sig=[a-f0-9]{64}($|&)", url.Query);
    }

    [Fact]
    public void BuildWsUrl_Https_DefaultPort_ReturnsWss443()
    {
        var url = new Uri(CommandChannelWorker.BuildWsUrl("https://example.com/api", "xyz", "secret"));
        Assert.Equal("wss", url.Scheme);
        Assert.Equal("example.com", url.Host);
        Assert.Equal(443, url.Port);
        Assert.Equal("/ws", url.AbsolutePath);
        Assert.Contains("clientId=xyz", url.Query);
    }

    [Fact]
    public void WebSocketSignature_IsDeterministicAndBoundToClient()
    {
        var first = WebSocketAuth.CreateSignature("CLIENT05", 1_700_000_000, "secret");
        var same = WebSocketAuth.CreateSignature("CLIENT05", 1_700_000_000, "secret");
        var otherClient = WebSocketAuth.CreateSignature("CLIENT06", 1_700_000_000, "secret");

        Assert.Equal(64, first.Length);
        Assert.Equal(first, same);
        Assert.NotEqual(first, otherClient);
    }

    [Fact]
    public void WebSocketSignature_MatchesServerProtocolVector()
    {
        var signature = WebSocketAuth.CreateSignature(
            "CLIENT05",
            1_788_169_058,
            "device-specific-secret");

        Assert.Equal(
            "f79daa7bc9e2314ed5892c80c7fcdebb7766b5985d3b6d76f46340545c6476bf",
            signature);
    }
}
