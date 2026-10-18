// Entropy (nats) of softmax(logits) over the whole vocabulary, ~0.06 ms for 248k entries when
// vectorised (built with -ffast-math -march=native, see Makefile); called once per generated token.
#include <algorithm>
#include <cmath>

float logits_entropy(const float * l, int n) {
    float mx = -INFINITY;
    for (int i = 0; i < n; ++i) mx = std::max(mx, l[i]);
    float z = 0, ez = 0;
    for (int i = 0; i < n; ++i) {
        const float d = l[i] - mx;
        const float e = expf(d);
        z += e;
        ez += e * d;
    }
    return logf(z) - ez / z;
}
