# llama_native.node: a Node-API addon linking libllama + libllama-common from an existing
# llama.cpp CUDA build (the router's build, so both paths run the same kernels).
#
#   make -C native LLAMA_DIR=/path/to/llama.cpp LLAMA_BUILD=/path/to/llama.cpp/build-cuda
#
# common/ is a C++ API without ABI guarantees: build against the same checkout that produced the
# shared libraries.

LLAMA_DIR   ?= $(HOME)/llama.cpp
LLAMA_BUILD ?= $(LLAMA_DIR)/build-cuda
LIBDIR      ?= $(LLAMA_BUILD)/bin
NODE_INC    ?= $(shell dirname $$(dirname $$(command -v node)))/include/node

CXX      ?= g++
CXXFLAGS ?= -O2 -g
CXXFLAGS += -std=c++17 -fPIC -Wall -Wextra -Wno-unused-parameter -Wno-missing-field-initializers -pthread \
            -DNODE_GYP_MODULE_NAME=llama_native -DNAPI_VERSION=8 \
            -I$(NODE_INC) -I$(LLAMA_DIR)/include -I$(LLAMA_DIR)/common -I$(LLAMA_DIR)/ggml/include -I$(LLAMA_DIR)/vendor
LDFLAGS  += -shared -L$(LIBDIR) -Wl,-rpath,$(LIBDIR) -lllama-common -lllama -lggml -lggml-base -pthread

SRC := engine.cpp service.cpp addon.cpp entropy.cpp
OBJ := $(SRC:%.cpp=build/%.o)

all: build/llama_native.node

build/%.o: %.cpp *.h | build
	$(CXX) $(CXXFLAGS) -c $< -o $@

build/entropy.o: entropy.cpp | build
	$(CXX) $(CXXFLAGS) -O3 -ffast-math -march=native -c $< -o $@

build/llama_native.node: $(OBJ)
	$(CXX) $(OBJ) -o $@ $(LDFLAGS)

build:
	mkdir -p build

clean:
	rm -rf build

.PHONY: all clean
